import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const data = JSON.parse(html);
  const concerts: Partial<Concert>[] = [];

  const products = data.products || [];
  for (const item of products) {
    // Only extract events that are categorised as Concerts (Konzert)
    if (item.supertitle !== 'Konzert') continue;

    const artistText = String(item.title || '').trim();
    const dateText = String(item.valid_start_on || '').trim();
    if (!artistText || !dateText) continue;

    let ticketUrl = item.url;
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
      venue: config.selectors?.venueNameFallback || 'SO36',
      city: config.selectors?.cityNameFallback || 'Berlin',
      country: config.selectors?.countryNameFallback || 'DE',
      lat: config.selectors?.lat,
      lng: config.selectors?.lng,
      ticketUrl,
      originalSource: config.domain,
      scrapedAt
    });
  }

  return concerts;
}
