import type { Concert } from '../schemas/concert.js';

// Existing schema-compatible convention used by the native tour scrapers.
export const UNKNOWN_VENUE = 'Unknown Venue';
const key = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

// Finite, country-scoped spelling equivalences, not metro-area membership.
// AM/GE/RS: accepted location-normalization brief, 2026-10-19.
// CY: Community Council https://www.agiostychonas.org.cy/el/ and the bilingual
// Cyprus government list https://enitest.moec.gov.cy/archeia/1/ypp13358a
// (Community Council of Agios Tychonas Lemesou / Άγιος Τύχωνας Λεμεσού).
const CITIES: Record<string, Record<string, string[]>> = {
  AM: { Yerevan: ['Երևան'] },
  GE: { Tbilisi: ["T'bilisi"], Batumi: [] },
  RS: { Belgrade: ['Beograd'] },
  CY: { 'Agios Tychonas': ['Άγιος Τύχων'], Limassol: [] }
};

export function citySpellings(city: string, country: string): string[] {
  for (const [canonical, aliases] of Object.entries(CITIES[country.toUpperCase()] ?? {})) {
    const spellings = [canonical, ...aliases];
    if (spellings.some(name => key(name) === key(city))) return spellings;
  }
  return [city];
}

export function canonicalCity(city: string, country: string): string {
  return citySpellings(city, country)[0];
}

export function hasCityAliases(city: string, country: string): boolean {
  return citySpellings(city, country).length > 1;
}

export function isUnknownVenue(venue: string): boolean {
  return key(venue) === key(UNKNOWN_VENUE);
}

/** Alias convergence must never merge distinct venues or turn an unknown
 * location into a metadata-compatible duplicate of another unknown location. */
export function locationDedupeSuffix(row: Pick<Concert, 'venue' | 'city' | 'country'>): string {
  return hasCityAliases(row.city, row.country)
    ? JSON.stringify([row.country, key(row.venue)]) : '';
}

export function normalizeLocation<T extends Pick<Concert, 'artist' | 'venue' | 'city' | 'country'> & { originalSource?: string }>(row: T, artistAliases: readonly string[] = []): T {
  const city = canonicalCity(row.city, row.country);
  let placeholder = false;
  if (/(^|\.)bandsintown\.com$/i.test(row.originalSource ?? '')) {
    // BIT's city is structured provider metadata. Native selector sources may
    // accidentally duplicate the entire real venue block into city; equality
    // alone must not erase those real venue names.
    placeholder = key(canonicalCity(row.venue, row.country)) === key(city);
    const names = [row.artist, ...artistAliases];
    const artist = names.map(name => name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).join('|');
    const title = artist && row.venue.trim().match(new RegExp(`^(?:${artist})(?:\\s+in\\s+|\\s+в\\s+|\\s*\\|\\s*)(.+)$`, 'iu'));
    if (title) {
      const suffix = canonicalCity(title[1], row.country);
      // A title can advertise Limassol while the source's locality is its
      // suburb. Recognize the title; never change the source settlement to it.
      const knownCity = Object.keys(CITIES[row.country.toUpperCase()] ?? {}).some(name => key(name) === key(suffix));
      placeholder ||= key(suffix) === key(city) || knownCity;
    }
  }
  return { ...row, city, venue: placeholder ? UNKNOWN_VENUE : row.venue };
}
