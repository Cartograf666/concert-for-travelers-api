import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const CANADIAN_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

function explicitDay(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error(`Scotty McCreery row has no explicit ISO date: ${value}`);
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) {
    throw new Error(`Scotty McCreery row has invalid date: ${value}`);
  }
  return match[1];
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Scotty McCreery') || !$('#upcoming-events').length) {
    throw new Error('Scotty McCreery official tour page is missing');
  }
  const concerts: Partial<Concert>[] = [];
  $('#upcoming-events .event').each((_, element) => {
    const row = $(element);
    const date = explicitDay(row.find('time.event__date').attr('datetime') || '');
    const location = row.find('.event__location').first().text().replace(/\s+/g, ' ').trim();
    const separator = location.lastIndexOf(',');
    const city = location.slice(0, separator).trim();
    const suffix = location.slice(separator + 1).trim();
    const country = US_STATES.has(suffix) ? 'US' : CANADIAN_PROVINCES.has(suffix) ? 'CA' : undefined;
    const venue = row.find('.event__venue').first().text().replace(/\s+/g, ' ').trim();
    const href = row.find('a.btn-tickets').first().attr('href');
    if (!country || separator < 0 || !city || !venue || !href) {
      throw new Error(`Scotty McCreery row has unverified location or missing venue/link: ${location}`);
    }
    concerts.push({ artist: config.selectors?.artistNameFallback || 'Scotty McCreery', date,
      venue, city, country, ticketUrl: safeAbsoluteUrl(href, config.url),
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
