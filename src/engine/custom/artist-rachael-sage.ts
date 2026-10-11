import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('tr.pm_top_tr').each((_, element) => {
    const row = $(element);
    const printed = row.children('td').first().text().trim();
    // This calendar's unambiguous 10/22, 10/25 etc. establish MM/DD/YYYY;
    // passing 10/11 through the multilingual parser would reverse its month/day.
    const day = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/.exec(printed);
    const date = day ? `${day[3]}-${day[1].padStart(2, '0')}-${day[2].padStart(2, '0')}` : undefined;
    const parsed = date ? new Date(`${date}T00:00:00Z`) : undefined;
    if (!date || !parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Rachael Sage event has an invalid native MM/DD/YYYY date');
    }
    const parts = row.find('.event_location').first().text().trim().split(',').map(value => value.trim());
    const suffix = parts.pop() || '';
    const country = suffix === 'UK' ? 'GB' : US_STATES.has(suffix) ? 'US' : undefined;
    // The UK record explicitly distinguishes the district Balham from London.
    let city = suffix === 'UK' ? parts.at(-1) : parts.length === 1 ? parts[0] : undefined;
    const venue = row.find('.event_venue').first().text().trim();
    if (!date || !country || !city || !venue) throw new Error('Rachael Sage event has an unverified date/location');
    // stables.org prints Stockwell Lane, Wavendon, Milton Keynes, MK17 8LU.
    if (city === 'Milton Keynes' && country === 'GB' && venue === 'The Stables') city = 'Wavendon';
    // The provider's same Castle Hotel event has the erroneous city "Greater".
    // Keep this exact collision held until its hub-owned provider identity is fixed.
    if (date === '2026-10-30' && city === 'Manchester' && venue === 'The Castle Hotel') return;
    const href = row.find('.event_venue a').first().attr('href');
    concerts.push({ artist: 'Rachael Sage', date, venue, city, country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
