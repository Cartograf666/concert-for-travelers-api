import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const VERIFIED_UK_CITIES = new Set(['Skegness', 'Burnham-on-Sea']);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('table.hc_rse_events_table tr:has(td.hc_rse_date)').each((_, element) => {
    const row = $(element);
    const date = row.find('td.hc_rse_date').first().text().replace(/\s+/g, ' ').trim();
    const location = row.find('td.hc_rse_title').first().text().replace(/\s+/g, ' ').trim();
    const separator = location.lastIndexOf(',');
    const venue = location.slice(0, separator).trim();
    const city = location.slice(separator + 1).trim();
    if (!date || !venue || !city || separator < 0 || !VERIFIED_UK_CITIES.has(city)) {
      throw new Error('Marmalade official tour row is missing a date, venue, city or verified country');
    }
    concerts.push({
      artist: 'Marmalade', date, venue, city, country: 'GB',
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
