import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('.tt-evt-li').toArray().map(element => {
    const row = $(element);
    const artist = row.find('.tt-evt-li__name').first().text().trim();
    const text = row.find('.tt-evt-li__sub-info--BeginDate').first().text().trim();
    const match = text.match(/^[^0-9]*?(\d{2}\.\d{2}\.20\d{2})\s*@\d{2}:\d{2}$/);
    const date = match ? parseDate(match[1], scrapedAt) : null;
    const href = row.find('.tt-evt-li__btn-holder a').first().attr('href');
    if (!artist || !date || !href) throw new Error('Majestic calendar row has an incomplete name, explicit date or event URL');
    return { artist, date, venue: 'Majestic Music Club', city: 'Bratislava', country: 'SK',
      lat: config.selectors?.lat, lng: config.selectors?.lng,
      ticketUrl: safeAbsoluteUrl(href, config.url), originalSource: config.domain, scrapedAt };
  });
}
