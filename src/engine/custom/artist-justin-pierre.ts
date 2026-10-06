import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

type SeatedEvent = {id?: unknown; type?: unknown; attributes?: Record<string, unknown>};
type Feed = {data?: {id?: unknown; attributes?: {name?: unknown}; relationships?: {'tour-events'?: {data?: {id?: unknown}[]}}}; included?: SeatedEvent[]};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const feed: Feed = JSON.parse(body);
  const refs = feed.data?.relationships?.['tour-events']?.data;
  if (feed.data?.id !== '4c0db77d-a5a9-41d1-80d4-910bc9a4054c' ||
      feed.data.attributes?.name !== 'Motion City Soundtrack' || !Array.isArray(refs) ||
      (refs.length > 0 && !Array.isArray(feed.included))) {
    throw new Error('Motion City Soundtrack official Seated feed has invalid artist identity or event references');
  }
  const events = new Map((feed.included ?? []).map((event) => [event.id, event]));
  return refs.map((ref) => {
    const event = events.get(ref.id);
    const fields = event?.attributes;
    const date = fields?.['starts-at-date-local'];
    const venue = fields?.['venue-name'];
    const location = fields?.['formatted-address'];
    if (event?.type !== 'tour-events' || typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
        typeof venue !== 'string' || !venue || typeof location !== 'string' || !/^([^,]+), FL$/.test(location)) {
      throw new Error('Motion City Soundtrack event lacks explicit date, venue or supported location');
    }
    return {
      artist: 'Motion City Soundtrack', date, venue, city: location.split(',')[0], country: 'US',
      ticketUrl: 'https://www.motioncitysoundtrack.com/tour', originalSource: config.domain, scrapedAt
    };
  });
}
