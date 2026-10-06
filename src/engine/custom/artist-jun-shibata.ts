import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('div.j-text').each((_, element) => {
    const section = $(element);
    const year = section.text().match(/CONCERT TOUR\s+(20\d{2})/)?.[1];
    if (!year) return;
    section.find('p').each((_, paragraph) => {
      const text = $(paragraph).text().replace(/\s+/g, ' ').trim();
      const match = text.match(/^●\s*(\d{1,2})月(\d{1,2})日\([^)]*\)\s*(.+?)（([^）]+)）開場/);
      if (!match) return;
      const month = Number(match[1]);
      const day = Number(match[2]);
      const venue = match[3].trim();
      const city = match[4].trim();
      if (month < 1 || month > 12 || day < 1 || day > 31 || !venue || !city) return;
      concerts.push({
        artist: 'Jun Shibata', date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        venue, city, country: 'JP', ticketUrl: config.url, originalSource: config.domain, scrapedAt
      });
    });
  });
  return concerts;
}
