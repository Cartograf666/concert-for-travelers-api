import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const ARTIST = 'Ray Scott';
const ARTIST_ID = '4110';
const PAGE = 'https://www.rayscott.com/tour';

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Ray Scott missing ${field}`);
  return value.trim();
}

function eventId(raw: string): string {
  const url = new URL(raw);
  const match = /^\/e\/(\d+)$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'www.bandsintown.com' ||
      url.username || url.password || !match) throw new Error('Ray Scott invalid native event URL');
  return match[1];
}

function isNativeArtistUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'www.bandsintown.com' &&
      url.pathname === `/a/${ARTIST_ID}` && !url.username && !url.password;
  } catch { return false; }
}

function eventDate(raw: string): string {
  const match = /^(20\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01]))T\d{2}:\d{2}:\d{2}/.exec(raw);
  if (!match) throw new Error('Ray Scott invalid event date');
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== match[1]) {
    throw new Error('Ray Scott impossible event date');
  }
  return match[1];
}

/** Parse the complete JSON-LD schedule that the official page renders with its native widget. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (config.url !== PAGE || config.domain !== 'www.rayscott.com' ||
      config.selectors?.artistNameFallback !== ARTIST) {
    throw new Error('Ray Scott official source identity mismatch');
  }
  const $ = cheerio.load(html);
  const widget = $('rr-bandsintown-widget');
  const iframe = widget.find('iframe[src*="widget.bandsintown.com/widget_iframe.html"]');
  if ($('head > title').first().text().trim() !== 'Tour') throw new Error('Ray Scott official tour title missing');
  if (widget.length !== 1) throw new Error('Ray Scott official tour widget missing');
  if (iframe.length !== 1) throw new Error('Ray Scott official tour widget identity missing');
  const iframeUrl = new URL(required(iframe.attr('src'), 'widget URL'));
  if (iframeUrl.protocol !== 'https:' || iframeUrl.hostname !== 'widget.bandsintown.com' ||
      iframeUrl.searchParams.get('artist_id') !== ARTIST_ID ||
      iframeUrl.searchParams.get('artist_name') !== ARTIST ||
      iframeUrl.searchParams.get('app_id') !== 'js_rhythmic-rebellion.com' ||
      iframeUrl.searchParams.get('affil_code') !== 'js_rayscott.com') {
    throw new Error('Ray Scott official widget artist identity mismatch');
  }
  const visibleIds = new Set<string>();
  widget.find('.bit-event').each((_, node) => {
    const link = $(node).find('a.bit-details[href]').first().attr('href');
    visibleIds.add(eventId(required(link, 'visible event link')));
  });
  if (!visibleIds.size || visibleIds.size !== widget.find('.bit-event').length) {
    throw new Error('Ray Scott native widget has no unique visible events');
  }
  const jsonScripts = $('script[type="application/ld+json"]');
  if (jsonScripts.length !== 1) throw new Error('Ray Scott native schedule JSON-LD missing');
  let data: unknown;
  try { data = JSON.parse(jsonScripts.first().text()); }
  catch { throw new Error('Ray Scott native schedule JSON-LD invalid'); }
  if (!Array.isArray(data) || data.length !== visibleIds.size) {
    throw new Error('Ray Scott visible widget and native schedule count mismatch');
  }
  const ids = new Set<string>();
  const concerts = data.map((value): Partial<Concert> => {
    const event = object(value);
    const venue = object(event?.location);
    const address = object(venue?.address);
    const performers = event?.performers;
    const organizer = object(event?.organizer);
    if (!event || event['@type'] !== 'MusicEvent' || !Array.isArray(performers) ||
        !performers.some(performer => object(performer)?.name === ARTIST) ||
        organizer?.name !== ARTIST || !isNativeArtistUrl(organizer.url) ||
        event.eventStatus !== 'https://schema.org/EventScheduled') {
      throw new Error('Ray Scott native event artist identity mismatch');
    }
    const ticketUrl = required(event.url, 'event URL');
    const id = eventId(ticketUrl);
    if (!visibleIds.has(id) || ids.has(id)) throw new Error('Ray Scott native event is absent or duplicated in widget');
    ids.add(id);
    if (address?.addressCountry !== 'United States') throw new Error('Ray Scott event country mismatch');
    const venueName = required(venue?.name, 'venue');
    let city = required(address?.addressLocality, 'city');
    // Bandsintown labels this one venue's municipality as Escambia County. The
    // venue itself confirms its clubhouse at this exact street address in
    // Pensacola Beach: https://www.pensacolabeachyachtclub.org/contact
    if (venueName === 'Pensacola Beach Yacht Club' && city === 'Escambia County' &&
        address?.streetAddress === '655 Pensacola Beach Blvd' && address?.postalCode === '32561' &&
        address?.addressRegion === 'FL') city = 'Pensacola Beach';
    if (/\bCounty$/.test(city)) throw new Error('Ray Scott event has county instead of city');
    return {
      artist: ARTIST,
      date: eventDate(required(event.startDate, 'event date')),
      venue: venueName,
      city,
      country: 'US',
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    };
  });
  return concerts;
}
