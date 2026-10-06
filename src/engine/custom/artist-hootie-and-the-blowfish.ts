import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { mapBitEventToConcert } from '../bandsintown.js';

const ARTIST = 'Hootie & The Blowfish';

/** The public feed belongs to artist id_3749 embedded in hootie.com/tour. */
export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const events: unknown = JSON.parse(body);
  if (!Array.isArray(events)) throw new Error('Hootie widget feed is not an event array');
  const ids = new Set<string>();
  return events.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Hootie widget feed has a malformed event');
    const event = item as Record<string, any>;
    const id = String(event.id || '');
    const name = String(event.artist?.name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
    if (!/^\d+$/.test(id) || ids.has(id) || String(event.artist?.id) !== '3749' || name !== 'hootieandtheblowfish') {
      throw new Error('Hootie widget feed has a duplicate or different artist identity');
    }
    ids.add(id);
    const rawDate = event.starts_at || event.datetime;
    if (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawDate)) {
      throw new Error(`Hootie widget event ${id} has an invalid date`);
    }
    const date = rawDate.slice(0, 10);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error(`Hootie widget event ${id} has an invalid calendar date`);
    }
    const concert = mapBitEventToConcert(event, ARTIST, scrapedAt);
    if (!concert) throw new Error(`Hootie widget event ${id} lacks a valid venue, city or country`);
    return { ...concert, originalSource: config.domain };
  });
}
