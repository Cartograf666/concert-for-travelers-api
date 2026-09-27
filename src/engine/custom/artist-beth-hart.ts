import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const COUNTRY_CODES: Readonly<Record<string, string>> = {
  belgium: 'BE',
  czechia: 'CZ',
  denmark: 'DK',
  finland: 'FI',
  france: 'FR',
  germany: 'DE',
  italy: 'IT',
  netherlands: 'NL',
  norway: 'NO',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  sweden: 'SE',
  switzerland: 'CH'
};

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  return safeAbsoluteUrl(href, base);
}

function parseLocation(raw: string): { city: string; country: string } | null {
  const parts = clean(raw).split(',').map(clean).filter(Boolean);
  if (parts.length < 2) return null;

  const suffix = parts.at(-1)!;
  const country = US_STATE_CODES.has(suffix)
    ? 'US'
    : COUNTRY_CODES[suffix.toLowerCase()];
  if (!country) return null;

  const city = clean(parts.slice(0, -1).join(', '));
  return city ? { city, country } : null;
}

export async function scrape(
  config: ScraperConfig,
  html: string,
  scrapedAt: string
): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('div.event_item').each((_, element) => {
    const block = $(element);
    const date = clean(block.find('.event_date').first().text());
    const venue = clean(block.find('.event_venue').first().text());
    const location = parseLocation(block.find('.event_geo').first().text());
    if (!date || !venue || !location) return;

    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Beth Hart',
      date,
      venue,
      city: location.city,
      country: location.country,
      ticketUrl: absoluteUrl(block.find('.event_tickets a.event_ticket-link').first().attr('href'), config.url),
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
