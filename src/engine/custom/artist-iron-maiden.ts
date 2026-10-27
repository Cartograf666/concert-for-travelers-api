import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry, parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!/ - Iron Maiden$/i.test($('title').text())) return [];
  const concerts: Partial<Concert>[] = [];
  $('.tour-info-row').each((_, el) => {
    const row = $(el);
    if (/cancelled|canceled|postponed/i.test(row.text() + ' ' + (row.attr('class') || ''))) return;
    const cols = row.children('.tour-info-col');
    const printed = cols.eq(0).text().trim();
    const date = /^\d{1,2} [A-Za-z]{3} 20\d{2}$/.test(printed) ? parseDate(printed, scrapedAt) : null;
    const location = cols.eq(1).text().split(',').map(s => s.trim());
    const country = normalizeCountry(location.at(-1) || '');
    const city = location.slice(0, -2).join(', ');
    const venue = cols.eq(2).text().trim();
    if (!date || !city || !venue || !['US', 'CA'].includes(country)) return;
    const ticket = row.find('a.buy-tickets-link').attr('href');
    concerts.push({ artist: 'Iron Maiden', date, city, country, venue,
      ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
