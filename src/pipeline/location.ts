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

// Accepted root correction, 2026-10-19: comparison forms only. These neither
// translate the published city nor infer a city from an arbitrary title.
const TITLE_CITY_FORMS: Record<string, string[][]> = { RU: [['Izhevsk', 'Ижевск', 'Ижевске']] };
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

function matchesCity(value: string, city: string, country: string): boolean {
  const candidate = key(canonicalCity(value, country));
  const expected = key(canonicalCity(city, country));
  return candidate === expected || (TITLE_CITY_FORMS[country.toUpperCase()] ?? [])
    .some(forms => forms.some(form => key(form) === expected) && forms.some(form => key(form) === candidate));
}

function matchesCountry(value: string, country: string): boolean {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  return key(value) === key(code) || key(value) === key(countryNames.of(code) ?? code);
}

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

export function isUnknownVenue(venue: string): boolean {
  return key(venue) === key(UNKNOWN_VENUE);
}

export function normalizeLocation<T extends Pick<Concert, 'artist' | 'venue' | 'city' | 'country'> & { originalSource?: string }>(row: T, artistAliases: readonly string[] = []): T {
  const city = canonicalCity(row.city, row.country);
  let placeholder = false;
  if (/(^|\.)bandsintown\.com$/i.test(row.originalSource ?? '')) {
    // BIT's city is structured provider metadata. Native selector sources may
    // accidentally duplicate the entire real venue block into city; equality
    // alone must not erase those real venue names.
    placeholder = matchesCity(row.venue, city, row.country);
    const cityCountry = row.venue.trim().match(/^([^,]+),\s*([^,]+)$/u);
    if (cityCountry && matchesCity(cityCountry[1], city, row.country) && matchesCountry(cityCountry[2], row.country)) placeholder = true;
    const names = [row.artist, ...artistAliases];
    const artist = names.map(name => name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).join('|');
    const title = artist && row.venue.trim().match(new RegExp(`^(?:${artist})(?:\\s+in\\s+|\\s+в\\s+|\\s*\\|\\s*)(.+)$`, 'iu'));
    if (title) {
      const suffix = canonicalCity(title[1], row.country);
      // A title can advertise Limassol while the source's locality is its
      // suburb. Recognize the title; never change the source settlement to it.
      const knownCity = Object.keys(CITIES[row.country.toUpperCase()] ?? {}).some(name => key(name) === key(suffix));
      placeholder ||= matchesCity(suffix, city, row.country) || knownCity;
    }
  }
  return { ...row, city, venue: placeholder ? UNKNOWN_VENUE : row.venue };
}
