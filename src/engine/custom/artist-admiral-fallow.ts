import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  const $ = cheerio.load(html);
  return $('.EventListingListItem').map((_, element) => {
    const row = $(element);
    const printed = row.find('.EventListingListItem-date').first().text().trim();
    const date = /, 20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    const parts = row.find('.EventListingListItem-venue a').first().text().trim().split(',').map(value => value.trim());
    const label = parts.pop() || '';
    const country = /^[A-Z]{2}$/.test(label) ? normalizeCountry(label) : '';
    const city = parts.pop();
    const venue = parts.join(', ');
    if (!date || !city || !venue || country !== label || !country) {
      throw new Error('Admiral Fallow event lacks a complete date or venue/city/country tuple');
    }
    const href = row.find('.EventListingListItem-ticketsLink').first().attr('href');
    return { artist: 'Admiral Fallow', date, venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, sourceEventUrl: config.url, originalSource: config.domain, scrapedAt };
  }).get();
}
