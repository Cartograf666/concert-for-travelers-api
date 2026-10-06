import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const CANADIAN_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));
const COUNTRIES: Readonly<Record<string, string>> = {
  australia: 'AU', canada: 'CA', germany: 'DE', mexico: 'MX',
  'united kingdom': 'GB', usa: 'US', 'united states': 'US'
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function place(raw: string): { venue: string; city?: string; country?: string } {
  const parts = raw.split(',').map(clean).filter(Boolean);
  const last = parts.at(-1) || '';
  const country = COUNTRIES[last.toLowerCase()]
    ?? (US_STATES.has(last) ? 'US' : CANADIAN_PROVINCES.has(last) ? 'CA' : undefined);
  return { venue: parts[0] || raw, city: parts.length >= 3 ? parts[1] : undefined, country };
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $(config.selectors?.eventBlock || '.bn-show-show-row').each((_, element) => {
    const row = $(element);
    const date = clean(row.find('.bn-show-date-inline').first().text());
    // The official Shows page is an archive. A card with no printed year must
    // not acquire the current year from the downstream date parser.
    if (!/\b(?:19|20)\d{2}\b/.test(date)) return;
    const rawVenue = clean(row.find('.bn-show-venue').first().text());
    if (!rawVenue) return;
    const href = row.attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Bassnectar',
      date, ...place(rawVenue),
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
