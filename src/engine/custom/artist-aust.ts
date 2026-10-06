import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('[data-framer-name="Next Event"]').each((_, element) => {
    const block = $(element);
    const date = block.find('[data-framer-name="Event Date"] time[datetime]').first().attr('datetime')?.slice(0, 10);
    const venue = block.find('[data-framer-name="Event Venue"]').first().text().trim();
    const location = block.find('[data-framer-name="Event City"]').first().text().trim().match(/^(.+?),\s*([A-Z]{2})$/);
    const href = block.find('a[data-framer-name="Tickets Button"][href]').first().attr('href');
    if (!date?.match(/^\d{4}-\d{2}-\d{2}$/) || !venue || !location || location[2] !== 'CH') return;
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'AUST', date, venue,
      city: location[1].trim(), country: 'CH',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
