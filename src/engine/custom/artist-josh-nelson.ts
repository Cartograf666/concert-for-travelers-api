import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('article.eventlist-event--upcoming').each((_, element) => {
    const row = $(element);
    const days = row.find('time.event-date').map((_, day) => $(day).attr('datetime')).get();
    if (days.length !== 1) return;
    const date = /^20\d{2}-\d{2}-\d{2}$/.test(days[0]) ? parseDate(days[0], scrapedAt) : null;
    if (!date) throw new Error('Josh Nelson event lacks an explicit date');
    const title = row.find('.eventlist-title').text().trim();
    const place = /\(([^,]+), ([A-Z]{2})\)$/.exec(title);
    const description = row.find('.eventlist-description').text().replace(/\s+/g, ' ').trim();
    const venue = /^At (?:the )?(.+?)(?: \([^)]*\))?$/.exec(description)?.[1];
    const city = place?.[1] === 'LA' && place[2] === 'CA' ? 'Los Angeles' : place?.[1];
    const country = place && US_STATES.has(place[2]) ? 'US' : undefined;
    const href = row.find('.eventlist-title-link').first().attr('href');
    concerts.push({ artist: 'Josh Nelson', date, venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
