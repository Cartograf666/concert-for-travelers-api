import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.event-item').each((_, element) => {
    const row = $(element);
    // These are performances of explicitly credited Copland works, not a claim
    // that the composer himself is appearing with the named orchestras.
    if (!row.find('.event-works a[href^="/works/"]').length ||
        !/COPLAND|Aaron Copland/i.test(row.find('.event-body').text()) ||
        !row.find('.event-artists').text().trim()) {
      throw new Error('Copland calendar event lacks native work credit or actual performers');
    }
    const address = row.find('.event-location').text().trim().split(',').map(value => value.trim());
    let country: string | undefined;
    let countryIndex = -1;
    for (let index = address.length - 1; index >= 0; index--) {
      const label = address[index];
      const code = label.length > 2 && label.toLowerCase() !== 'georgia' ? normalizeCountry(label) : '';
      if (/^[A-Z]{2}$/.test(code)) { country = code; countryIndex = index; break; }
    }
    const venue = address[0];
    const city = countryIndex >= 2 ? address[countryIndex - 1] : undefined;
    if (!venue || !city || !country) throw new Error('Copland calendar address lacks an explicit venue/city/country');
    const href = row.find('.event-links a').first().attr('href');
    row.find('.event-dates span').each((_, node) => {
      const printed = $(node).text().trim();
      const match = /^([A-Za-z]{3}) (\d{1,2})(?:st|nd|rd|th)(?:\s*&\s*(\d{1,2})(?:st|nd|rd|th))?, (20\d{2}) (\d{1,2}):(\d{2}) ([ap]m)$/.exec(printed);
      const month = match ? MONTHS.indexOf(match[1]) + 1 : 0;
      if (!match || !month || Number(match[5]) < 1 || Number(match[5]) > 12 || Number(match[6]) > 59) {
        throw new Error('Copland calendar has an unsupported native performance date/time');
      }
      const hour = Number(match[5]) % 12 + (match[7] === 'pm' ? 12 : 0);
      const startTime = `${String(hour).padStart(2, '0')}:${match[6]}`;
      for (const day of [match[2], ...(match[3] ? [match[3]] : [])]) {
        const date = `${match[4]}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
        const parsed = new Date(`${date}T00:00:00Z`);
        if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Copland calendar has an impossible day');
        concerts.push({ artist: 'Aaron Copland', date, startTime, venue, city, country,
          ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
      }
    });
  });
  return concerts;
}
