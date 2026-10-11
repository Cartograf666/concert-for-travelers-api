import type { RawConcert } from '../schemas/concert.js';

const TRAIN_SPOTIFY_ID = '3RqgnylU44Y6V4fF05p1Wp';
const TRAIN_AARHUS_EVENT_IDS = new Set(['/t/1040223915', '/t/1040093753', '/t/1040317158', '/t/1040290880']);

/** The Aarhus venue/promoter TRAIN lists other acts at these four events:
 * https://train.dk/om and https://train.dk/kalender/vepsestikk-2026 */
function isVerifiedTrainCollision(raw: RawConcert, matchedSpotifyId?: string): boolean {
  if (matchedSpotifyId !== TRAIN_SPOTIFY_ID || raw.originalSource !== 'bandsintown.com') return false;
  const eventUrl = raw.sourceEventUrl || raw.ticketUrl;
  if (!eventUrl) return false;
  try {
    const url = new URL(eventUrl);
    return (url.hostname === 'bandsintown.com' || url.hostname === 'www.bandsintown.com') &&
      TRAIN_AARHUS_EVENT_IDS.has(url.pathname.replace(/\/$/, ''));
  } catch {
    return false;
  }
}

/** This official event bills DJ Kish on 18 October 2026, not an approved
 * DJ Krush alias. Quarantine only this unsupported fuzzy attribution, bound
 * to the known canonical MBID and native event occurrence/location.
 * https://www.kittysu.com/event/PureLoveSundayPresentsKoothRoyaltyTributeToLadyBai */
function isVerifiedKittySuCollision(raw: RawConcert, matchedMbid?: string | null): boolean {
  if (matchedMbid !== '38d16213-25ba-450d-8665-4e08548e62e3' ||
      !['kittysu.com','www.kittysu.com'].includes(raw.originalSource?.trim().toLowerCase() || '') ||
      raw.artist?.trim().toLowerCase() !== 'dj kish' || raw.date !== '2026-10-18' ||
      raw.venue !== 'Kitty Ko The LaLiT Ashok Bangalore' || raw.city !== 'Bangalore' || raw.country !== 'IN') return false;
  try {
    const url = new URL(raw.sourceEventUrl || raw.ticketUrl || '');
    return url.protocol === 'https:' && ['kittysu.com','www.kittysu.com'].includes(url.hostname) &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname.replace(/\/$/, '') === '/event/PureLoveSundayPresentsKoothRoyaltyTributeToLadyBai';
  } catch { return false; }
}

/** The organizer identifies this event as the distinct Montpellier tribute band:
 * https://shotgun.live/en/events/nice-guys-pain-for-pleasure
 * Keep the exclusion bound to that provider event and the Canadian canonical
 * MBID; the name alone cannot distinguish the two bands. */
export function isVerifiedSourceIdentityCollision(raw: RawConcert, matchedMbid?: string | null, matchedSpotifyId?: string): boolean {
  if (isVerifiedTrainCollision(raw, matchedSpotifyId) || isVerifiedKittySuCollision(raw, matchedMbid)) return true;
  if (matchedMbid !== '60d0d63e-5404-4c13-b01e-d024f71a43b2' ||
      raw.originalSource !== 'bandsintown.com') return false;
  const eventUrl = raw.sourceEventUrl || raw.ticketUrl;
  if (!eventUrl) return false;
  try {
    const url = new URL(eventUrl);
    return (url.hostname === 'bandsintown.com' || url.hostname === 'www.bandsintown.com') &&
      url.pathname.replace(/\/$/, '') === '/t/1038425781';
  } catch {
    return false;
  }
}
