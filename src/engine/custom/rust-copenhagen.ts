import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('article.event').each((_, element) => {
    const row = $(element);
    const artist = row.find('h2.event-title').first().text().replace(/\s+/g, ' ').trim();
    const rawDate = row.find('meta[itemprop=startDate]').first().attr('content')?.trim();
    const parts = rawDate?.match(/^(20\d{2})(\d{2})(\d{2})(?:\s+\d{2}:\d{2})?$/);
    const date = parts ? parseDate(`${parts[1]}-${parts[2]}-${parts[3]}`, scrapedAt) : null;
    if (!artist || !date) throw new Error('RUST event is missing its name or explicit calendar date');
    const href = row.find('a.event-ticket-link').first().attr('href');
    concerts.push({ artist, date, venue: 'RUST', city: 'Copenhagen', country: 'DK',
      lat: config.selectors?.lat, lng: config.selectors?.lng,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
