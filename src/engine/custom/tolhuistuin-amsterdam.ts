import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

/**
 * Tolhuistuin Amsterdam events agenda scraper.
 * The page embeds all events as a JSON array in the `:all-items` attribute of `<agenda-filter-component>`.
 */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const raw = $('agenda-filter-component').attr(':all-items');
  if (!raw) {
    throw new Error('Could not find :all-items attribute in agenda-filter-component');
  }

  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    throw new Error('Parsed :all-items is not an array');
  }

  const concerts: Partial<Concert>[] = [];
  for (const item of items) {
    const artistText = String(item?.title || '').trim();
    const dateText = String(item?.eventStartDate || '').trim();
    if (!artistText || !dateText) continue;

    let ticketUrl: string | undefined = item?.ticketLink || item?.url;
    if (ticketUrl && !ticketUrl.startsWith('http')) {
      try {
        ticketUrl = new URL(ticketUrl, config.url).toString();
      } catch {
        // Keep original if parsing fails
      }
    }

    concerts.push({
      artist: artistText,
      date: dateText,
      venue: config.selectors?.venueNameFallback || 'Tolhuistuin',
      city: config.selectors?.cityNameFallback || 'Amsterdam',
      country: config.selectors?.countryNameFallback || 'NL',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  }

  return concerts;
}
