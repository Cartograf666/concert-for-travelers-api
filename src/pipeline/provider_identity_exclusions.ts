import type { RawConcert } from '../schemas/concert.js';

/** The organizer identifies this event as the distinct Montpellier tribute band:
 * https://shotgun.live/en/events/nice-guys-pain-for-pleasure
 * Keep the exclusion bound to that provider event and the Canadian canonical
 * MBID; the name alone cannot distinguish the two bands. */
export function isVerifiedSourceIdentityCollision(raw: RawConcert, matchedMbid?: string | null): boolean {
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
