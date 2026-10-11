import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const GERMAN_VENUES: Record<string, string> = {
  "HUXLEY'S NEUE WELT": 'Berlin',
  'Konzert- und Ballhaus Neue Welt': 'Zwickau'
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  const $ = cheerio.load(html);
  return $('.LiveDates-Item').map((_, element) => {
    const row = $(element);
    const printed = row.find('.LiveDates-Date time').text().trim();
    const venue = row.find('.LiveDates-Venue').text().trim();
    const city = row.find('.LiveDates-Location').text().trim();
    const href = row.find('.LiveDates-Tickets a').first().attr('href');
    const ticketUrl = href ? safeAbsoluteUrl(href, config.url) : undefined;
    let date: string | undefined;
    let country: string | undefined;
    if (ticketUrl) {
      const url = new URL(ticketUrl);
      // The same native event record explicitly names its Germany Live year.
      const year = url.hostname === 'www.eventim.de'
        ? /\/paul-carrack-germany-live-(20\d{2})-/.exec(url.pathname)?.[1] : undefined;
      const day = /^([A-Z]{3}) (\d{1,2})$/.exec(printed);
      const month = day ? MONTHS.indexOf(day[1]) + 1 : 0;
      if (year && day && month && GERMAN_VENUES[venue] === city) {
        date = `${year}-${String(month).padStart(2, '0')}-${day[2].padStart(2, '0')}`;
        const parsed = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Paul Carrack has an impossible native event day');
        country = 'DE';
      }
    }
    return { artist: 'Paul Carrack', date, venue, city, country, ticketUrl, sourceEventUrl: config.url, originalSource: config.domain, scrapedAt };
  }).get();
}
