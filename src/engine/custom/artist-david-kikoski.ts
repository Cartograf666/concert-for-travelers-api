import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'
};
const OBSERVED_US_STATES = new Set(['NY', 'AZ', 'NJ']);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  const today = scrapedAt.slice(0, 10);
  $('.kv-ee-event').each((_, element) => {
    const block = $(element);
    const day = block.find('.kv-ee-day').first().clone().children().remove().end().text().trim();
    const month = MONTHS[block.find('.kv-ee-month').first().clone().children().remove().end().text().trim()];
    const year = block.find('.kv-ee-year').first().clone().children().remove().end().text().trim();
    const venue = block.find('.kv-ee-location .kv-ee-small').first().clone().children().remove().end().text().trim();
    const location = block.find('.kv-ee-location .kv-ee-large').first().clone().children().remove().end().text().trim().match(/^(.+?),\s*([A-Z]{2})$/);
    if (!day.match(/^\d{1,2}$/) || !month || !year.match(/^\d{4}$/) || !venue || !location || !OBSERVED_US_STATES.has(location[2])) return;
    const date = `${year}-${month}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today) return;
    const href = block.find('.kv-ee-tickets a[href]').first().attr('href');
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'David Kikoski', date, venue,
      city: location[1].trim(), country: 'US',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined,
      originalSource: config.domain, scrapedAt
    });
  });
  return concerts;
}
