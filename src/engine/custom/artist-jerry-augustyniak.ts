import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { bandsintownCountryToCode } from '../bandsintown.js';

type Event = {id?: unknown; artist_id?: unknown; starts_at?: unknown; url?: unknown; venue?: {
  name?: unknown; city?: unknown; country?: unknown
}};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const events: Event[] = JSON.parse(body);
  if (!Array.isArray(events)) throw new Error('10,000 Maniacs official widget feed is not an event list');
  const seen = new Set<string>();
  return events.map((event) => {
    if (event.artist_id !== '47037' || typeof event.id !== 'string' || seen.has(event.id) ||
        typeof event.starts_at !== 'string' || !/^20\d{2}-\d{2}-\d{2}T/.test(event.starts_at) ||
        typeof event.url !== 'string' || typeof event.venue?.name !== 'string' ||
        typeof event.venue.city !== 'string' || typeof event.venue.country !== 'string') {
      throw new Error('10,000 Maniacs feed row has invalid artist identity or event fields');
    }
    seen.add(event.id);
    const country = bandsintownCountryToCode(event.venue.country);
    if (!country) throw new Error(`10,000 Maniacs feed has unknown country: ${event.venue.country}`);
    return {
      artist: '10,000 Maniacs', date: event.starts_at.slice(0, 10), venue: event.venue.name,
      city: event.venue.city, country, ticketUrl: event.url,
      originalSource: config.domain, scrapedAt
    };
  });
}
