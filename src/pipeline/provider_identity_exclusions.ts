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

/** The organizer identifies this event as the distinct Montpellier tribute band:
 * https://shotgun.live/en/events/nice-guys-pain-for-pleasure
 * Keep the exclusion bound to that provider event and the Canadian canonical
 * MBID; the name alone cannot distinguish the two bands. */
export function isVerifiedSourceIdentityCollision(raw: RawConcert, matchedMbid?: string | null, matchedSpotifyId?: string): boolean {
  if (isVerifiedTrainCollision(raw, matchedSpotifyId)) return true;
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
