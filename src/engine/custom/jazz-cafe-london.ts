import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Jazz Cafe London events agenda scraper.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('li.event').each((_, el) => {
    // 1. Extract artist / title
    const artistText = $(el).find('h2.event-title').text().replace(/\s+/g, ' ').trim();
    
    // 2. Extract date and format as "EEE dd MMM" (e.g. "Tue 07 Jul")
    const dateEl = $(el).find('.event-date');
    if (!dateEl.length) return;
    
    const clone = dateEl.clone();
    const span = clone.find('span');
    const dayVal = span.text().trim();
    span.replaceWith(` ${dayVal} `);
    const dateText = clone.text().replace(/\s+/g, ' ').trim(); // e.g. "Tue 07 Jul"

    if (!artistText || !dateText) return;

    // 3. Extract ticketUrl
    let ticketUrl = $(el).find('a').attr('href');
    if (ticketUrl && !ticketUrl.startsWith('http')) {
      try {
        ticketUrl = new URL(ticketUrl, config.url).toString();
      } catch {
        // Keep original
      }
    }

    concerts.push({
      artist: artistText,
      date: dateText,
      venue: config.selectors?.venueNameFallback || 'Jazz Cafe',
      city: config.selectors?.cityNameFallback || 'London',
      country: config.selectors?.countryNameFallback || 'GB',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
