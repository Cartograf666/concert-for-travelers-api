import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

type Event = {eventId?: unknown; eventDateTime?: unknown; active?: unknown; private?: unknown;
  title?: {headlinersText?: unknown}; venue?: {venueId?: unknown; title?: unknown; city?: unknown; countryCode?: unknown}};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const feed: {meta?: {total?: unknown}; events?: Event[]} = JSON.parse(body);
  if (!Array.isArray(feed.events) || feed.meta?.total !== feed.events.length) {
    throw new Error('Jacobs Pavilion official calendar feed is incomplete');
  }
  const ids = new Set<string>();
  const concerts: Partial<Concert>[] = [];
  for (const event of feed.events) {
    if (typeof event.eventId !== 'string' || ids.has(event.eventId) ||
        typeof event.eventDateTime !== 'string' || !/^20\d{2}-\d{2}-\d{2}T/.test(event.eventDateTime) ||
        typeof event.title?.headlinersText !== 'string' || event.venue?.venueId !== '127892' ||
        event.venue.title !== 'Jacobs Pavilion' || event.venue.city !== 'Cleveland' || event.venue.countryCode !== 'US') {
      throw new Error('Jacobs Pavilion event has invalid venue, date or title');
    }
    ids.add(event.eventId);
    if (!event.active || event.private || /\bMOVED TO\b/i.test(event.title.headlinersText)) continue;
    concerts.push({
      artist: event.title.headlinersText, date: event.eventDateTime.slice(0, 10),
      venue: 'Jacobs Pavilion', city: 'Cleveland', country: 'US',
      ticketUrl: new URL(`/events/detail?event_id=${event.eventId}`, 'https://jacobspavilion.com').href,
      originalSource: config.domain, scrapedAt
    });
  }
  return concerts;
}
