import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * La Cigale Paris events agenda scraper.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('li.artiste-event__item').each((_, el) => {
    // 1. Extract artist
    const artistText = $(el).find('h3.artiste-event__title').text().trim();
    if (!artistText) return;

    // 2. Extract date from data-date attribute (YYYYMMDD -> YYYY-MM-DD)
    const rawDate = $(el).attr('data-date'); // e.g. "20260905"
    let dateText = '';
    if (rawDate && rawDate.length === 8) {
      dateText = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    }

    if (!dateText) return;

    // 3. Extract ticketUrl
    let ticketUrl = $(el).find('a.artiste-event__link').attr('href');
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
      venue: config.selectors?.venueNameFallback || 'La Cigale',
      city: config.selectors?.cityNameFallback || 'Paris',
      country: config.selectors?.countryNameFallback || 'FR',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
