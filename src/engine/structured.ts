import * as cheerio from 'cheerio';
import { ScraperConfig } from '../schemas/config.js';
import { Concert } from '../schemas/concert.js';

/**
 * schema.org @type values that represent a concert-like event.
 */
const EVENT_TYPES = new Set([
  'event',
  'musicevent',
  'festival',
  'musicfestival',
  'theaterevent',
  'danceevent',
  'comedyevent',
  'socialevent'
]);

function typeMatches(type: unknown): boolean {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && EVENT_TYPES.has(t.toLowerCase()));
}

/**
 * Walks an arbitrary JSON-LD tree (objects, arrays, and @graph containers) and
 * collects every node whose @type is event-like.
 */
function collectEventNodes(node: any, out: any[], seen = new Set<any>()): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) collectEventNodes(item, out, seen);
    return;
  }

  if (typeMatches(node['@type'])) {
    out.push(node);
  }

  // Recurse into @graph and any nested value that might carry events (e.g. subEvent).
  if (Array.isArray(node['@graph'])) {
    for (const item of node['@graph']) collectEventNodes(item, out, seen);
  }
  if (node.subEvent) collectEventNodes(node.subEvent, out, seen);
  if (node.events) collectEventNodes(node.events, out, seen);
}

/** Coerce a possibly-nested schema.org value to a trimmed string. */
function asText(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return asText(value[0]);
  if (typeof value === 'object') return asText(value.name ?? value['@value'] ?? '');
  return '';
}

/** Pull the artist/headliner name, preferring an explicit performer over the event title. */
function extractArtist(node: any): string {
  const performer = node.performer ?? node.performers;
  const performerName = asText(performer);
  if (performerName) return performerName;
  return asText(node.name);
}

function extractDate(node: any): string {
  // startDate is ISO 8601; keep it raw — the pipeline's parseDate handles the ISO prefix.
  return asText(node.startDate) || asText(node.doorTime);
}

function firstAddress(location: any): any {
  if (!location) return undefined;
  if (Array.isArray(location)) return firstAddress(location[0]);
  return location.address;
}

/**
 * Extracts concerts from schema.org JSON-LD embedded in the page. Returns an
 * empty array when the page carries no usable event markup — callers treat that
 * as "not a JSON-LD source" and fall back to selectors.
 */
export function extractJsonLd(config: ScraperConfig, html: string, scrapedAt: string): Partial<Concert>[] {
  const $ = cheerio.load(html);
  const nodes: any[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text() || $(el).text();
    if (!raw || !raw.trim()) return;
    // Strip CDATA wrappers some CMSes emit; skip a bad block rather than the whole page.
    const cleaned = raw.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      collectEventNodes(parsed, nodes);
    } catch {
      // Malformed JSON-LD block — ignore it.
    }
  });

  const fb = config.selectors;
  const concerts: Partial<Concert>[] = [];

  for (const node of nodes) {
    const artist = extractArtist(node);
    const date = extractDate(node);
    if (!artist || !date) continue;

    const address = firstAddress(node.location);
    const locationName = Array.isArray(node.location)
      ? asText(node.location[0]?.name)
      : asText(node.location?.name);

    const city = asText(address?.addressLocality) || fb?.cityNameFallback || '';
    // schema.org addressCountry is often a full name; only trust a 2-letter code, else fall back.
    const rawCountry = asText(address?.addressCountry);
    const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry : (fb?.countryNameFallback || '');
    const venue = locationName || fb?.venueNameFallback || '';

    // offers.url (offers may be an object or an array) -> ticket link; fall back to the event url.
    const offers = node.offers;
    const offerUrl = Array.isArray(offers) ? asText(offers.map((o: any) => o?.url).find(Boolean)) : asText(offers?.url);
    const rawUrl = offerUrl || asText(node.url);
    let ticketUrl: string | undefined;
    if (rawUrl) {
      try {
        ticketUrl = new URL(rawUrl, config.url).toString();
      } catch {
        ticketUrl = rawUrl;
      }
    }

    concerts.push({
      artist,
      date,
      venue,
      city,
      country,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  }

  return concerts;
}
