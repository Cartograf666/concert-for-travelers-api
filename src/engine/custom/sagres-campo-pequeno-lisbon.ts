import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * This venue's calendar widget renders dates as MM.DD.YYYY (confirmed: several
 * events show a day value >12, e.g. "09.17.2026" and "09.23.2026", which can
 * only be valid if the first number is the month). The shared parseDate() always
 * treats a dotted date as DD.MM.YYYY, so plain static_selectors would silently
 * mis-parse the ambiguous cases (both numbers <=12, e.g. "09.12.2026") the other
 * way. This module builds the ISO date directly from the known field order
 * instead of leaving it to the generic (DD.MM-assuming) parser.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('div.event').each((_, element) => {
    const block = $(element);
    const artistText = block.find('.card-title').text().trim();
    const dateText = block.find('.date').text().trim();

    const m = dateText.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!artistText || !m) return;
    const [, month, day, year] = m;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    let ticketUrl: string | undefined;
    const href = block.find('a').first().attr('href');
    if (href) {
      try {
        ticketUrl = new URL(href, config.url).toString();
      } catch {
        ticketUrl = href;
      }
    }

    concerts.push({
      artist: artistText,
      date: isoDate,
      venue: config.selectors?.venueNameFallback,
      city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
