import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.entry-content > .wp-block-columns').each((_, element) => {
    const columns = $(element).children('.wp-block-column');
    if (columns.length < 3) return;
    const date = columns.eq(0).text().trim();
    const venue = columns.eq(1).find('strong').first().text().trim();
    const location = columns.eq(1).find('p').first().text().trim();
    const city = location.slice(venue.length).split(',')[0]?.trim();
    const href = columns.eq(2).find('a[href]').first().attr('href');
    if (!/\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{4}/.test(date) || !venue || !city) return;
    concerts.push({
      artist: 'James Alexander Bright', date, venue, city, country: 'GB',
      ticketUrl: href ? new URL(href, config.url).href : config.url,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
