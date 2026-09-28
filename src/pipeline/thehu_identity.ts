import type { Concert } from '../schemas/concert.js';

// Exact observations corroborated on 2026-09-28 by the official artist,
// venue and Ticketmaster pages. The HU is distinct from The Hub. See proof fixture.
const VERIFIED_OBSERVATIONS: readonly (readonly (string | null)[])[] = [
  [
    "3olympia.ie",
    "Tue 6th Oct 2026",
    null,
    "3Olympia Theatre",
    "Dublin",
    "IE"
  ],
  [
    "ticketmaster.com",
    "2026-09-29",
    "https://www.ticketmaster.co.uk/the-hu-warrior-chant-tour-glasgow-29-09-2026/event/3E00645A9EEC31E3",
    "O2 Academy Glasgow",
    "Glasgow",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-01",
    "https://www.ticketmaster.co.uk/the-hu-bristol-01-10-2026/event/3500645AE9C5735C",
    "The Prospect Building",
    "Bristol",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-02",
    "https://www.ticketmaster.co.uk/the-hu-warrior-chant-tour-bournemouth-02-10-2026/event/3E006459E974688E",
    "O2 Academy Bournemouth",
    "Bournemouth",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-03",
    "https://www.ticketmaster.co.uk/the-hu-newcastle-upon-tyne-03-10-2026/event/3E006459DEE361BB",
    "O2 City Hall Newcastle",
    "Newcastle Upon Tyne",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-05",
    "https://www.ticketmaster.ie/the-hu-belfast-05-10-2026/event/38006459955D191E",
    "The Telegraph Building",
    "Belfast",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-08",
    "https://www.ticketmaster.co.uk/the-hu-warrior-chant-tour-birmingham-08-10-2026/event/3E0064599E4F3D02",
    "O2 Academy Birmingham",
    "Birmingham",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-09",
    "https://www.ticketmaster.co.uk/the-hu-london-09-10-2026/event/3E006459F14C6D61",
    "O2 Academy Brixton",
    "London",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-10",
    "https://www.ticketmaster.co.uk/the-hu-manchester-10-10-2026/event/3600645B93833A65",
    "O2 Apollo Manchester",
    "Manchester",
    "GB"
  ],
  [
    "ticketmaster.com",
    "2026-10-06",
    "https://www.ticketmaster.ie/the-hu-dublin-06-10-2026/event/1800645A88B58FAF",
    "3Olympia Theatre",
    "Dublin",
    "IE"
  ]
];
const keys = new Set(VERIFIED_OBSERVATIONS.map(row => JSON.stringify(row)));

export function isTheHuIdentity(entry: unknown): boolean {
  return (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name) === 'The HU';
}

export function isTheHuName(name: string): boolean {
  return name.trim().toLowerCase() === 'the hu';
}

/** A fresh or cached row must match the same certificate. Unknown TheHu rows
 * stay on hold rather than inheriting The Hub's identity and metadata. */
export function isVerifiedTheHuObservation(raw: Partial<Concert>): boolean {
  if (!raw.artist || !isTheHuName(raw.artist) || !raw.date) return false;
  let endpoint: string | null = null;
  if (raw.ticketUrl !== undefined) {
    if (typeof raw.ticketUrl !== 'string' || !raw.ticketUrl) return false;
    try {
      const url = new URL(raw.ticketUrl);
      if (url.protocol !== 'https:' || url.username || url.password) return false;
      endpoint = url.origin + url.pathname.replace(/\/$/, '');
    } catch { return false; }
  }
  // Only the exact Dublin venue/date/source tuple permits an absent URL;
  // all other observations require their entire verified HTTPS endpoint.
  return keys.has(JSON.stringify([raw.originalSource, raw.date, endpoint, raw.venue, raw.city, raw.country]));
}

/** Preserve the baseline whole-record winner only for the verified Dublin pair.
 * An official-source authority rank, when present, still takes precedence. */
export function verifiedTheHuDublinSourceRank(raw: Partial<Concert>): number {
  if (!isVerifiedTheHuObservation(raw) || raw.venue !== '3Olympia Theatre' ||
      raw.city !== 'Dublin' || raw.country !== 'IE') return 0;
  if (raw.originalSource === '3olympia.ie' && raw.date === 'Tue 6th Oct 2026') return 1;
  if (raw.originalSource === 'ticketmaster.com' && raw.date === '2026-10-06') return 2;
  return 0;
}
