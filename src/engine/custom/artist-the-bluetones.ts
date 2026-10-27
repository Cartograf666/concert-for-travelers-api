import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  // Scope each schedule to its native artist heading, never unrelated gigpress tables.
  $('table.gigpress-table').each((_, table) => {
    if ($(table).prevAll('h3.gigpress-artist-heading').first().clone().children().remove().end().text().trim() !== 'The Bluetones') return;
    $(table).find('tr.gigpress-row').each((_, el) => {
      const row = $(el);
      const info = row.next('tr.gigpress-info');
      if (/cancelled|canceled|postponed/i.test(row.text() + info.text() + ' ' + (row.attr('class') || ''))) return;
      const printed = row.find('.gigpress-date').text().trim();
      const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(printed);
      const iso = m ? `20${m[3]}-${m[2]}-${m[1]}` : '';
      if (!iso || parseDate(iso, scrapedAt) !== iso) {
        throw new Error(`The Bluetones malformed active date: ${printed || 'missing date'}`);
      }
      const city = row.find('.gigpress-city').text().trim();
      const venue = row.find('.gigpress-venue').text().trim();
      const country = normalizeCountry(row.find('.gigpress-country').text().trim());
      if (!city || !venue || !/^[A-Z]{2}$/.test(country)) {
        throw new Error('The Bluetones malformed active location');
      }
      const ticket = info.find('a.gigpress-tickets-link').attr('href');
      concerts.push({ artist: 'The Bluetones', date: iso, city, venue, country,
        ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined,
        originalSource: config.domain, scrapedAt });
    });
  });
  return concerts;
}
