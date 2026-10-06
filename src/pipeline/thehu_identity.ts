import type { Concert } from '../schemas/concert.js';

export function isTheHuIdentity(entry: unknown): boolean {
  return (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name) === 'The HU';
}

export function isTheHuName(name: string): boolean {
  return name.trim().toLowerCase() === 'the hu';
}

/** Keep the corroborated Dublin duplicate as a whole record after artist-site
 * enrichment replaces both providers' ticket links with the same artist URL.
 * This historical tie-break does not restrict which future The HU shows match.
 * Official artist-source authority still takes precedence in processConcerts.
 */
export function verifiedTheHuDublinSourceRank(raw: Partial<Concert>): number {
  if (raw.artist?.trim().toLowerCase() !== 'the hu' || raw.venue !== '3Olympia Theatre' ||
      raw.city !== 'Dublin' || raw.country !== 'IE') return 0;
  if (raw.originalSource === '3olympia.ie' && raw.date === 'Tue 6th Oct 2026' &&
      raw.ticketUrl === undefined) return 1;
  if (raw.originalSource !== 'ticketmaster.com' || raw.date !== '2026-10-06' ||
      typeof raw.ticketUrl !== 'string') return 0;
  try {
    const url = new URL(raw.ticketUrl);
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.hostname === 'www.ticketmaster.ie' &&
      url.pathname.replace(/\/$/, '') === '/the-hu-dublin-06-10-2026/event/1800645A88B58FAF' ? 2 : 0;
  } catch { return 0; }
}
