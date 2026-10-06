import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const concerts: Partial<Concert>[] = [];
  // The official Wix page contains both summary and detail copies of each card.
  $('div.UQ7hfV').each((_, element) => {
    const card = $(element);
    const date = card.find('h2').first().text().trim();
    const location = card.find('p').first().text().trim();
    if (!/^\w+,\s+\w+,\s+\d{1,2}(?:st|nd|rd|th)\s+\d{4}$/.test(date) || !location) return;
    const separator = location.lastIndexOf(',');
    if (separator < 1) return;
    const venue = location.slice(0, separator).trim();
    const city = location.slice(separator + 1).trim();
    const country = city === 'Dubai' ? 'AE' : ['Mumbai', 'Bengaluru', 'Chennai'].includes(city) ? 'IN' : '';
    if (!venue || !country) return;
    const key = `${date}|${venue}|${city}`;
    if (seen.has(key)) return;
    seen.add(key);
    concerts.push({
      artist: 'Ranjani-Gayatri', date, venue, city, country,
      ticketUrl: config.url, originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
