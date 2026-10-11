import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  return $('article.card.event').map((_, element) => {
    const row = $(element);
    const printedDate = row.find('time').first().attr('datetime')?.trim() || '';
    const date = /^[A-Za-z]{3} \d{1,2} 20\d{2}$/.test(printedDate) ? parseDate(printedDate, scrapedAt) : null;
    const place = row.find('p.location').first().text().trim().match(/^(.+), ([A-Z]{2})$/);
    const venue = row.find('h1.card-title').first().text().trim();
    if (!date || !place || !US_STATES.has(place[2]) || !venue) {
      throw new Error('Randy Houser event lacks an explicit date, venue or verified state');
    }
    const href = row.find('a.btn-tickets').first().attr('href');
    const city = place[1].trim() === 'Ft. Worth' && place[2] === 'TX' ? 'Fort Worth' : place[1].trim();
    return { artist: 'Randy Houser', date, venue, city, country: 'US',
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt };
  }).get();
}
