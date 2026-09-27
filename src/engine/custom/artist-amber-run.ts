import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

// Current official route plus the immediately preceding rows still present in
// the source cache. This is deliberately not an Intl region-name check: Intl
// also accepts non-country regions such as EU and UN.
const EVIDENCED_COUNTRIES = new Set(['AT', 'BE', 'CH', 'DE', 'GB', 'NL']);

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isCountryCode(value: string): boolean {
  return EVIDENCED_COUNTRIES.has(value);
}

/** Music Glue emits one explicit location field in the form "City, ISO". */
function parseLocation(value: string): { city: string; country: string } | null {
  const match = clean(value).match(/^(.+?),\s*([A-Z]{2})$/);
  if (!match || !isCountryCode(match[2])) return null;
  const city = clean(match[1]);
  return city ? { city, country: match[2] } : null;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('article.EventListingListItem').each((_, element) => {
    const block = $(element);
    const date = clean(block.find('.EventListingListItem-date-day').first().text());
    const venue = clean(block.find('.EventListingListItem-venue-name').first().text());
    const location = parseLocation(block.find('.EventListingListItem-venue-city').first().text());
    if (!date || !venue || !location) return;

    const href = block.find('a.EventListingListItem-content').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Amber Run',
      date,
      venue,
      city: location.city,
      country: location.country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
