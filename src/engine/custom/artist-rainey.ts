import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

// These are the two explicitly confirmed Irish locations on the current page.
// A future unlabelled location must be verified rather than inheriting Ireland.
const VERIFIED_CITIES = new Set(['West Cork', 'Cork']);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('body').text().includes('Stephanie Rainey')) throw new Error('Stephanie Rainey source identity is missing');
  return $('tr.gigpress-row').toArray().map(element => {
    const row = $(element);
    const date = row.find('.gigpress-date strong').text().trim();
    const location = row.find('.gigpress-city');
    const venue = location.find('span').text().trim();
    const city = location.clone().children().remove().end().text().trim();
    const href = row.find('a.gigpress-tickets-link').attr('href');
    if (!/^\d{1,2} [A-Za-z]{3} 20\d{2}$/.test(date) || !venue || !VERIFIED_CITIES.has(city) || !href) {
      throw new Error('Stephanie Rainey row has incomplete date, venue or unverified country');
    }
    return { artist: 'Stephanie Rainey', date, venue, city, country: 'IE',
      ticketUrl: new URL(href, config.url).href, originalSource: config.domain, scrapedAt };
  });
}
