import type { Concert } from '../schemas/concert.js';

const TWIN_ATLANTIC_MBID = '98a819b7-2634-4987-815b-bc66182dc97f';
// The promoter explicitly marks these six shows Cancelled (checked 2026-10-07):
// https://www.livenation.co.uk/twin-atlantic-tickets-adp3019
// Ticketmaster corroborates Birmingham and Dundee. Captured provider caches
// predate the cancellation; bind their rejection to the canonical artist and
// exact date/place, keeping Leeds 2026-10-16 and future replacement shows.
const CANCELLED_SHOWS = [
  ['2026-10-17', 'birmingham', ['o2 institute2 birmingham', 'o2 institute birmingham']],
  ['2026-10-18', 'newcastle upon tyne', ['boiler shop']],
  ['2026-10-20', 'london', ['islington assembly hall']],
  ['2026-10-21', 'manchester', ['gorilla', 'manchester gorilla']],
  ['2026-10-23', 'glasgow', ['swg3']],
  ['2026-10-24', 'dundee', ["fat sam's live", 'twin atlantic @ fat sams live']]
] as const;

export function isVerifiedCancelledTwinAtlanticEvent(
  raw: Partial<Concert>, normalizedDate: string, matchedMbid?: string | null
): boolean {
  if (matchedMbid !== TWIN_ATLANTIC_MBID || raw.country?.trim().toUpperCase() !== 'GB') return false;
  const city = raw.city?.trim().replace(/\s+/g, ' ').toLowerCase();
  const venue = raw.venue?.trim().replace(/\s+/g, ' ').toLowerCase();
  return CANCELLED_SHOWS.some(([date, cancelledCity, venues]) =>
    normalizedDate === date && city === cancelledCity && venues.some(value => value === venue));
}
