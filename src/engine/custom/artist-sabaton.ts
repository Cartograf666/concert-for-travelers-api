import * as cheerio from 'cheerio';
import type { Concert } from '../../schemas/concert.js';
import type { ScraperConfig } from '../../schemas/config.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const events: Partial<Concert>[] = [];
  $('div.tour-wrapper table tr:has(span.tour-date)').each((_, row) => {
    const event = $(row);
    // The country label owns its text; the nested city can contain US state
    // codes (MD, CA) which must not be interpreted as another country.
    const country = event.find('span.tour-country-city').first().clone()
      .children().remove().end().text().replace(/[,\s]+$/, '').trim();
    const date = event.find('span.tour-date').first().text().trim();
    const venue = event.find('span.tour-venue').first().text().trim();
    const city = event.find('span.tour-city').first().text().trim();
    if (!country || !date || !venue || !city) return;
    const href = event.find('span.tour-tickets a.btn-primary').first().attr('href');
    events.push({
      artist: 'Sabaton', date, venue, city, country,
      ...(href ? { ticketUrl: safeAbsoluteUrl(href, config.url) } : {}),
      originalSource: config.domain, scrapedAt
    });
  });
  return events;
}
