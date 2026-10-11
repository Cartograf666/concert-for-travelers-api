import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Andy Timmons')) throw new Error('Andy Timmons source identity missing');
  const concerts: Partial<Concert>[] = [];
  $('table.gigpress-table tr.gigpress-row').each((_, element) => {
    const row = $(element);
    const info = row.next('tr.gigpress-info');
    const calendar = info.find('a[href*="google.com/calendar/event"]').attr('href');
    const dates = calendar ? new URL(calendar).searchParams.get('dates') : undefined;
    const fullDate = dates?.match(/^(\d{4})(\d{2})(\d{2})T/)?.slice(1).join('-');
    const printed = row.find('.gigpress-date').text().trim();
    // Gigpress prints a two-digit year; its paired native calendar supplies the complete year.
    if (!fullDate || parseDate(fullDate, scrapedAt) !== fullDate || parseDate(printed, scrapedAt) !== fullDate) {
      throw new Error('Andy Timmons printed date/calendar mismatch or missing complete year');
    }
    const city = row.find('.gigpress-city').text().trim();
    const venue = row.find('.gigpress-venue').text().trim();
    const country = row.find('.gigpress-country').text().trim();
    if (!city || !venue || !country) throw new Error('Andy Timmons row has incomplete native location');
    const ticket = info.find('a.gigpress-tickets-link').attr('href');
    concerts.push({ artist: 'Andy Timmons', date: fullDate, city, venue, country,
      ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined,
      originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
