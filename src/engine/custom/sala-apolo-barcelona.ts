import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Sala Apolo Barcelona events scraper.
 * Extracts date from event URL pattern: /evento/slug-YYYYMMDD-id
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('div.c-results__event').each((_, el) => {
    const block = $(el);

    // 1. Extract artist from event title link
    const titleLink = block.find('a.c-results__event__title');
    const artistText = titleLink.text().trim().replace(/\s+/g, ' ');
    if (!artistText) return;

    // 2. Extract date from event URL: /es/evento/slug-YYYYMMDD-id
    const href = titleLink.attr('href') || '';
    const dateMatch = href.match(/(\d{8})-\d+$/);
    let dateText = '';
    if (dateMatch) {
      const raw = dateMatch[1]; // e.g. "20260707"
      dateText = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    if (!dateText) return;

    // 3. Build ticket URL
    let ticketUrl = href;
    if (ticketUrl && !ticketUrl.startsWith('http')) {
      try {
        ticketUrl = new URL(ticketUrl, config.url).toString();
      } catch {
        // keep original
      }
    }

    concerts.push({
      artist: artistText,
      date: dateText,
      venue: config.selectors?.venueNameFallback || 'Sala Apolo',
      city: config.selectors?.cityNameFallback || 'Barcelona',
      country: config.selectors?.countryNameFallback || 'ES',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
