import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { normalizeCountry } from '../../pipeline/process.js';

// The official Lady A widget supplies dates/cities but fills venue.name with the
// tour title. These eight exact event venues are independently listed by its
// ticket provider: https://www.ticketmaster.com/lady-a-tickets/artist/1173672
const VERIFIED_VENUES: Record<string, { date: string; city: string; venue: string }> = {
  '108502894': { date: '2026-12-10', city: 'Northfield', venue: 'Northfield Park Racino - Center Stage' },
  '108495626': { date: '2026-12-11', city: 'Gary', venue: 'Hard Rock Live Northern Indiana' },
  '108495629': { date: '2026-12-12', city: 'Shipshewana', venue: 'Blue Gate Performing Arts Center' },
  '108495634': { date: '2026-12-17', city: 'New York', venue: 'Beacon Theatre' },
  '108495638': { date: '2026-12-18', city: 'Bensalem', venue: 'Xcite Center' },
  '108495642': { date: '2026-12-19', city: 'Greensboro', venue: 'Steven Tanger Center for the Performing Arts' },
  '108495644': { date: '2026-12-21', city: 'Nashville', venue: 'Ryman Auditorium' },
  '108495646': { date: '2026-12-21', city: 'Nashville', venue: 'Ryman Auditorium' }
};

type Event = { id?: unknown; artist_id?: unknown; artist?: { id?: unknown }; datetime?: unknown; url?: unknown;
  venue?: { city?: unknown; country?: unknown } };

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
  const date = value.slice(0, 10);
  return !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const events = JSON.parse(body) as Event[];
  if (!Array.isArray(events)) throw new Error('Lady A official widget feed is not an event list');
  const concerts: Partial<Concert>[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.artist_id !== '6132' || (event.artist && event.artist.id !== '6132') ||
        typeof event.id !== 'string' || !/^\d+$/.test(event.id) || seen.has(event.id)) {
      throw new Error('Lady A widget feed row has invalid artist identity or duplicate ID');
    }
    seen.add(event.id);
    if (!validCalendarDate(event.datetime) || typeof event.venue?.city !== 'string' ||
        !event.venue.city.trim() || event.venue.city.length > 120 ||
        typeof event.venue.country !== 'string' ||
        typeof event.url !== 'string' || !event.url.startsWith('https://www.bandsintown.com/e/')) {
      throw new Error(`Lady A event ${event.id} has invalid date, location, or event URL`);
    }
    const country = normalizeCountry(event.venue.country);
    if (!/^[A-Z]{2}$/.test(country)) throw new Error(`Lady A event ${event.id} has unrecognized country`);
    const date = event.datetime.slice(0, 10);
    const city = event.venue.city.trim();
    const proof = VERIFIED_VENUES[event.id];
    if (proof && (date !== proof.date || city !== proof.city || country !== 'US')) {
      throw new Error(`Lady A event ${event.id} no longer matches its verified venue`);
    }
    concerts.push({
      artist: 'Lady Antebellum',
      date, venue: proof?.venue, city, country,
      ticketUrl: event.url, originalSource: config.domain, scrapedAt
    });
  }
  return concerts;
}
