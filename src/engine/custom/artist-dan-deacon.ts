import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const OBSERVED_US_STATES = new Set(['TX', 'AZ', 'TN', 'MD', 'HI']);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.entry-content > p > a[href]').each((_, element) => {
    const link = $(element);
    const match = link.text().trim().match(/^•?\s*(\d{2})\/(\d{2})\/(\d{4})\s+\w+\s+[–-]\s+(.+?)\s+[–-]\s+(.+?),\s*([A-Z]{2})$/);
    if (!match || !OBSERVED_US_STATES.has(match[6])) return;
    const [, month, day, year, venue, city] = match;
    const date = `${year}-${month}-${day}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
    const href = link.attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Dan Deacon', date,
      venue: venue.trim(), city: city.trim(), country: 'US',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
