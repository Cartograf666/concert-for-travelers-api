import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

// The official embedded widget contains 16 future rows, but most venue.name
// fields are tour titles or cruise names. Only these three identify real venues.
const VERIFIED_VENUES: Record<string, { date: string; city: string; venue: string }> = {
  '108340664': { date: '2026-10-30', city: 'Oakland', venue: "Yoshi's" },
  '1037704792': { date: '2026-11-06', city: 'Fayetteville', venue: 'Trilith Live' },
  '1040019012': { date: '2026-11-11', city: 'Richmond', venue: 'The Tin Pan' }
};

type Event = { id?: unknown; artist_id?: unknown; datetime?: unknown; url?: unknown;
  venue?: { city?: unknown; country?: unknown } };

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const events = JSON.parse(body) as Event[];
  if (!Array.isArray(events)) throw new Error('Rick Braun official widget feed is not an event list');
  const concerts: Partial<Concert>[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.artist_id !== '46323' || typeof event.id !== 'string' || seen.has(event.id)) {
      throw new Error('Rick Braun widget feed row has invalid artist identity or duplicate ID');
    }
    seen.add(event.id);
    const proof = VERIFIED_VENUES[event.id];
    if (!proof) continue;
    if (typeof event.datetime !== 'string' || event.datetime.slice(0, 10) !== proof.date ||
        event.venue?.city !== proof.city || event.venue.country !== 'United States' ||
        typeof event.url !== 'string' || !event.url.startsWith('https://www.bandsintown.com/e/')) {
      throw new Error(`Rick Braun event ${event.id} no longer matches its verified venue`);
    }
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Rick Braun',
      date: proof.date, venue: proof.venue, city: proof.city, country: 'US',
      ticketUrl: event.url, originalSource: config.domain, scrapedAt
    });
  }
  return concerts;
}
