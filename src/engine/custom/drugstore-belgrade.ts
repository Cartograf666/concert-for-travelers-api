import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Drugstore Belgrade events scraper.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  $('h2.entry-title a').each((_, el) => {
    const linkEl = $(el);
    
    // 1. Extract date from span
    const dateSpan = linkEl.find('span');
    const dateText = dateSpan.text().trim(); // e.g. "19/09/2026"
    
    // 2. Clone and remove span to get clean artist/title
    const clone = linkEl.clone();
    clone.find('span').remove();
    const artistText = clone.text().replace(/\s+/g, ' ').trim(); // e.g. "XAOC INDOOR HARDCORE VOL. V"

    if (!artistText || !dateText) return;

    // 3. Extract ticketUrl
    let ticketUrl = linkEl.attr('href');
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
      venue: config.selectors?.venueNameFallback || 'Drugstore',
      city: config.selectors?.cityNameFallback || 'Belgrade',
      country: config.selectors?.countryNameFallback || 'RS',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  });

  return concerts;
}
