import type { RawConcert } from '../schemas/concert.js';

/** Finite existing primary-evidence corrections, not a city/day merge rule.
 * Beth Hart: tests/artist_locations_20260927.test.ts cites the organiser's move
 * mailing from Swiss Life Hall to Kuppelsaal on this date.
 * Andrea: tests/artist_country_merge_safety.test.ts and captured official agenda
 * identify Teatro Monumental; the BIT record puts the performer in venue.
 * Raw caches stay untouched. New dates, other venues/sources/identities survive.
 */
export function isKnownVenueConflict(raw: RawConcert, artist: string, date: string, mbid?: string | null, spotifyId?: string): boolean {
  if (raw.originalSource?.trim().toLowerCase() !== 'bandsintown.com') return false;
  const expected = artist === 'Beth Hart'
    ? ['3fe817fc-966e-4ece-b00a-76be43e7e73c', '30TrHDLNCKQVTYWOn9QqOC']
    : ['572a2e29-9f60-4b88-926f-69a299dd1b1f', '6CEcslhZk3A6cnin9neg5j'];
  if ((mbid && mbid !== expected[0]) || (spotifyId && spotifyId !== expected[1])) return false;
  if (artist === 'Beth Hart' && raw.artist === artist && date === '2026-11-21' &&
      raw.venue === 'Swiss Life Hall' && raw.city === 'Hannover' && raw.country === 'DE') return true;
  return artist === 'Andrea Motis' && raw.artist === artist && date === '2026-11-20' &&
    raw.venue === 'ANDREA MOTIS' && raw.city === 'Madrid' && raw.country === 'ES';
}
