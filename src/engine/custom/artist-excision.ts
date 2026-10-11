import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('.events-list .event').each((_, element) => {
    const row = $(element);
    const printed = row.find('.event-day-text').first().text().trim();
    // A festival interval is not proof of Excision's individual performance day.
    if (/^[A-Za-z]+ \d{1,2} - \d{1,2}, 20\d{2}$/.test(printed)) return;
    const date = /^[A-Za-z]+ \d{1,2}, 20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    const parts = row.find('.event-location-text').first().text().trim().split(',').map(value => value.trim());
    const country = normalizeCountry(parts.at(-1) || '');
    const region = parts.at(-2) || '';
    const validRegion = country === 'US' ? US_STATES.has(region) : country === 'CA' && CA_PROVINCES.has(region);
    const venue = row.find('.event-venue-text').first().text().trim();
    if (!date || !validRegion || !parts[0] || parts.length < 3 || !venue) {
      throw new Error('Excision event lacks a single explicit date or a consistent country/region');
    }
    const href = row.find('.event-ticket-link').first().attr('href');
    concerts.push({ artist: 'Excision', date, venue, city: parts[0], country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
