import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  $('li.tour-item').each((_, element) => {
    const row = $(element);
    const printed = row.find('.tour-timeframe').first().text().replace(/\s+/g, ' ').trim();
    const date = /20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    if (!date) throw new Error('Iration event lacks an explicit native year/date');
    if (date < scrapedAt.slice(0, 10)) return;
    const location = row.find('.tour-location-city').first().text().trim();
    const parts = location.split(',').map(value => value.trim());
    const state = /^([A-Z]{2})(?: \d{5}(?:-\d{4})?)?$/.exec(parts[1] || '');
    const label = parts.at(-1) || '';
    const namedCountry = label.length > 2 && label.toLowerCase() !== 'georgia' ? normalizeCountry(label) : '';
    const country = /^[A-Z]{2}$/.test(namedCountry) ? namedCountry : state && US_STATES.has(state[1]) ? 'US' : undefined;
    const validRegion = country === 'US' ? state && US_STATES.has(state[1]) :
      country === 'MX' && parts[1] === 'Q.R.';
    const venue = row.find('.tour-venue-name').first().text().trim();
    if (!country || !validRegion || !parts[0] || !venue) {
      throw new Error('Iration event lacks an explicit year or a verified city/state/postcode');
    }
    const href = row.find('.tour-actions a').first().attr('href');
    concerts.push({ artist: 'Iration', date, venue, city: parts[0], country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
