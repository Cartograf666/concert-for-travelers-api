import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('article.eventlist-event--upcoming').each((_, element) => {
    const row = $(element);
    const printed = row.find('time.event-date').first().attr('datetime') || '';
    const date = /^20\d{2}-\d{2}-\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    if (!date) throw new Error('Ann Reed event lacks an explicit date');
    const title = row.find('.eventlist-title').text().trim();
    if (/Ann Reed Live From Somewhere In Her House!/.test(title)) return;
    const body = row.find('.eventlist-description').text().replace(/\s+/g, ' ').trim();
    const place = /^Ann Reed with Joan Griffith[:,] (.+), ([^,]+), MN$/.exec(title);
    let venue = place?.[1];
    let city = place?.[2];
    if (/at the State Theater, 96 E 4th St Zumbrota MN 55992/.test(body)) {
      venue = 'State Theater'; city = 'Zumbrota';
    }
    if (/at the Hastings Arts Center, 216 4th St\. E, Hastings, MN 55033/.test(body)) {
      venue = 'Hastings Arts Center'; city = 'Hastings';
    }
    const href = row.find('.eventlist-title-link').first().attr('href');
    concerts.push({ artist: 'Ann Reed', date, venue, city, country: venue && city ? 'US' : undefined,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
