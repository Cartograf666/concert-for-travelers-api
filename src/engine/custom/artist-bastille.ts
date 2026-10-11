import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('umg-event').map((_, element) => {
    const row = $(element);
    const printed = row.attr('data-gig-datetime') || '';
    const iso = /^(20\d{2}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.exec(printed);
    const date = iso ? parseDate(iso[1], scrapedAt) : null;
    const parts = row.find('[part="location"]').first().text().trim().split(',').map(value => value.trim());
    const label = parts.at(-1) || '';
    const country = label.length > 2 && label.toLowerCase() !== 'georgia' ? normalizeCountry(label) : '';
    const venue = row.find('[part="venue"]').first().text().trim();
    if (!date || parts.length !== 2 || !parts[0] || !/^[A-Z]{2}$/.test(country) || !venue) {
      throw new Error('Bastille event lacks a native ISO date or an explicit country name');
    }
    const href = row.find('umg-link[data-offer-type="tickets"]').first().attr('url');
    return { artist: 'Bastille', date, venue, city: parts[0], country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt };
  }).get();
}
