import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = 'January February March April May June July August September October November December'.split(' ');
// Native direct ACO concert credits are verified; commission partner concerts,
// gala, workshop and rehearsal entries do not share that performance contract.
const VERIFIED_PROGRAMS = new Set([
  '/performances-events/hello-america-we-gather-here',
  '/performances-events/a-night-of-inspiration',
  '/performances-events/new-virtuoso-low-end-theory'
]);

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.p-e-item').each((_, element) => {
    const row = $(element);
    const href = row.find('.event-title a').first().attr('href');
    if (!href || !VERIFIED_PROGRAMS.has(href)) return;
    if (!/American Composers Orchestra|ACO\s+performs/.test(row.find('.event-description').text())) {
      throw new Error('ACO concert lacks native performer credit');
    }
    const month = MONTHS.indexOf(row.find('.when .month').eq(0).text().trim()) + 1;
    const year = row.find('.when .month').eq(1).text().trim();
    const day = row.find('.when .day').text().trim();
    const clock = /^(\d{1,2}):(\d{2}) ([ap]m)$/.exec(row.find('.when .hour').text().trim());
    const date = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    const city = row.find('.performance-location_wrapper > div').eq(0).text().trim();
    const state = row.find('.performance-location_wrapper > div').eq(2).text().trim();
    const venue = row.find('.event-location').text().trim();
    if (!/^20\d{2}$/.test(year) || !month || !/^\d{1,2}$/.test(day) ||
        Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
        !clock || Number(clock[1]) < 1 || Number(clock[1]) > 12 || Number(clock[2]) > 59 ||
        city !== 'New York' || state !== 'New York' || !venue) {
      throw new Error('ACO concert lacks an exact date/time or native city/state/venue');
    }
    const hour = Number(clock[1]) % 12 + (clock[3] === 'pm' ? 12 : 0);
    const ticket = row.find('a.event-tickets-button').first().attr('href');
    concerts.push({ artist: 'American Composers Orchestra', date, startTime: `${String(hour).padStart(2, '0')}:${clock[2]}`,
      venue, city, country: 'US', ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
