import * as fs from 'fs/promises';
import * as path from 'path';
import * as chrono from 'chrono-node';
import didYouMean, { ThresholdTypeEnums } from 'didyoumean2';
import { Concert, ConcertSchema } from '../schemas/concert.js';

/** Format a Date as a timezone-safe YYYY-MM-DD using its local calendar fields. */
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ISO 3166-1 alpha-2 codes for the touring markets this project actually scrapes
// (Europe + the other major concert markets). Used to build a full-English-name ->
// code reverse lookup below, since some sites (e.g. schema.org addressCountry
// microdata on artist tour pages) render the country as a name ("Germany"), not
// the 2-character code ConcertSchema requires.
const KNOWN_COUNTRY_CODES = [
  'AD', 'AT', 'AU', 'BA', 'BE', 'BG', 'BR', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE',
  'ES', 'FI', 'FR', 'GB', 'GE', 'GR', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'JP', 'LT',
  'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO',
  'RS', 'RU', 'SE', 'SG', 'SI', 'SK', 'TR', 'UA', 'US', 'ZA'
];

/** Reverse lookup: full English country name (lowercased) -> ISO alpha-2 code. */
function buildCountryNameToCode(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of KNOWN_COUNTRY_CODES) {
      const name = displayNames.of(code);
      if (name) map.set(name.toLowerCase(), code);
    }
  } catch {
    // Intl.DisplayNames unavailable (older runtime) -- country normalization
    // just won't apply; raw 2-letter codes still pass through unaffected.
  }
  // A couple of common short/alternate forms Intl doesn't produce by default.
  map.set('uk', 'GB');
  map.set('the united kingdom', 'GB');
  map.set('usa', 'US');
  map.set('the united states', 'US');
  map.set('the netherlands', 'NL');
  map.set('czech republic', 'CZ');
  return map;
}
const COUNTRY_NAME_TO_CODE = buildCountryNameToCode();

/** Accepts either a 2-letter code or a full English country name (e.g. schema.org
 * addressCountry microdata, which some sites render as a name, not a code). */
export function normalizeCountry(raw: string): string {
  // Some sites nest a city span inside the same element as the country text with
  // no separating markup (e.g. Sabaton's tour page: a "tour-country-city" element
  // whose cheerio .text() yields "Bulgaria, Plovdiv" once the nested city span's
  // text is concatenated in) -- neither 2-letter codes nor country names contain a
  // comma, so taking only the part before the first one recovers just the country.
  // .trim() also strips a trailing non-breaking space from an &nbsp; entity.
  // A trailing parenthetical alternate name ("Slovakia (Slovak Republic)") is
  // dropped too -- the primary name before it is what the lookup below expects.
  const cleaned = raw.split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  // Check the name map first (case-insensitive) -- some informal 2-letter
  // abbreviations ("UK") are not valid ISO codes themselves (the real code is
  // "GB"), so a bare length check can't be trusted to mean "already a code".
  const byName = COUNTRY_NAME_TO_CODE.get(cleaned.toLowerCase());
  if (byName) return byName;
  return cleaned.toUpperCase();
}

// A year-less date is only assumed to be next year once it is more than this many
// days in the past — so a listing scraped a few days late (e.g. "3 July" seen on
// the 7th) stays in the current year instead of jumping ~12 months forward.
const YEARLESS_GRACE_DAYS = 31;

/**
 * Resolve a year-less date to its intended occurrence relative to baseDate: a
 * "5 Jan" scraped in December belongs to next year, but a date that only just
 * passed (within the grace window) keeps the current year.
 */
function resolveYearless(monthNum: string, day: string, baseDate: Date): string {
  const baseYear = baseDate.getFullYear();
  const candidate = new Date(`${baseYear}-${monthNum}-${day}T00:00:00`);
  const graceMs = YEARLESS_GRACE_DAYS * 24 * 60 * 60 * 1000;
  if (candidate.getTime() < baseDate.getTime() - graceMs) {
    return `${baseYear + 1}-${monthNum}-${day}`;
  }
  return `${baseYear}-${monthNum}-${day}`;
}

/**
 * Generates a slug for deduplication index keys (e.g. "The Cure" -> "the-cure")
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Escapes regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clean common suffixes/prefixes from artist names. The hyphen-led suffixes
 * require at least one space before the hyphen ("Artist - Live" is a suffix
 * marker) so a hyphenated stage name with no surrounding spaces ("J-Live",
 * a real approved artist) isn't mistaken for one and truncated.
 */
export function cleanArtistName(name: string): string {
  return name
    .replace(/\s+-\s*sold\s*out\b/gi, '')
    .replace(/\s*\(sold\s*out\)/gi, '')
    .replace(/\s+-\s*live\b.*/gi, '')
    .replace(/\s+-\s*special\s*guest\b.*/gi, '')
    .replace(/\s+-\s*tour\b.*/gi, '')
    .replace(/\s*\(support\)/gi, '')
    .replace(/\s*\(live\)/gi, '')
    .trim();
}

export type ArtistMatch = { name: string; website?: string | null; socials?: any };
export type ApprovedMatcher = (scrapedName: string) => ArtistMatch | null;

// Names this short are matched only by exact equality, never as a whole-word
// substring or fuzzy candidate — otherwise "10cc"/"M83"/two-letter names hit
// inside unrelated titles, or absorb an unrelated short name within edit distance.
const SHORT_NAME_MAX = 3;

// Edit-distance-based fuzzy fallback (tier 4) is a last resort for minor scraping
// noise (a dropped trailing "!", a stray accent). An absolute distance (not a
// similarity ratio) keeps it tight regardless of name length -- "Unknown Artist"
// must NOT fuzzy-match "Unknown Hinson" just because both are 14 characters.
const FUZZY_MAX_EDIT_DISTANCE = 2;

/**
 * Builds a whole-word/whole-string boundary around an approved name, but only on
 * the side(s) where the name itself starts/ends with a word character. A name
 * ending in punctuation (e.g. "Against Me!") has no word character abutting the
 * end of the string, so `\b` there would never fire — anchoring only where a real
 * boundary can exist fixes that without weakening the check for ordinary names.
 */
function buildSubstringRegex(name: string): RegExp {
  const escaped = escapeRegExp(name);
  const left = /^\w/.test(name) ? '\\b' : '';
  const right = /\w$/.test(name) ? '\\b' : '';
  return new RegExp(`${left}${escaped}${right}`, 'i');
}

/**
 * Precompile the approved-artist list into a fast reusable matcher. Regexes are
 * built ONCE here instead of once per scraped concert (the list is ~62k entries
 * and the pipeline runs twice), which is the bulk of the matching cost.
 *
 * Matching is tiered so the most specific/trustworthy signal always wins:
 *   1. Exact match (case-insensitive) — always accepted outright, even if the
 *      name itself contains "cover"/"tribute" as a substring (David Coverdale,
 *      Groove Coverage), since an exact hit against the approved list can't be
 *      a fake tribute act.
 *   2. Whole-word cover/tribute-band filter (only rejects a literal word, not a
 *      substring, so "Coverdale"/"Undercover" survive).
 *   3. Whole-word/whole-string substring match, longest approved name first — so
 *      a short generic entry ("alan") can never shadow a longer, more specific
 *      one ("Alan Walker") that also matches. Also requires the matched name to
 *      cover a minimum fraction of the cleaned string (MIN_SUBSTRING_COVERAGE):
 *      real approved-artist entries that are also common dictionary words
 *      ("Music", "Band", "Live", "Darts", "Mega", "Queer" were all found live in
 *      data/approved_artists.json) would otherwise match inside ANY unrelated
 *      event title containing that word ("World Series of Darts Finals" ->
 *      "Darts", "QUEER WRESTLING CIRCUS" -> "Queer") -- confirmed against real
 *      scraped output, not hypothetical.
 *   4. Fuzzy fallback (edit-distance) for minor scraping noise tier 1-3 miss.
 */

// A substring match only counts if the approved name makes up at least this
// fraction of the cleaned string -- otherwise a short dictionary-word artist
// name swallows unrelated non-music event titles that merely contain that word.
const MIN_SUBSTRING_COVERAGE = 0.25;
export function buildApprovedMatcher(approvedArtists: any[]): ApprovedMatcher {
  const entries = approvedArtists
    .map((approved) => {
      const name: string = typeof approved === 'string' ? approved : approved?.name ?? '';
      return { approved, name, lower: name.toLowerCase() };
    })
    .filter((e) => e.name);

  const exactByLower = new Map(entries.map((e) => [e.lower, e]));

  const longNames = entries.filter((e) => e.name.length > SHORT_NAME_MAX);
  // Longest-first so a more specific match is tested (and wins) before a shorter one.
  const bySubstring = longNames
    .map((e) => ({ ...e, regex: buildSubstringRegex(e.name) }))
    .sort((a, b) => b.name.length - a.name.length);
  const fuzzyNames = longNames.map((e) => e.name);

  const toMatch = (e: { name: string; approved: any }): ArtistMatch =>
    typeof e.approved === 'string'
      ? { name: e.name }
      : { name: e.approved.name, website: e.approved.website, socials: e.approved.socials };

  return (scrapedName: string): ArtistMatch | null => {
    const cleaned = cleanArtistName(scrapedName);
    const lowerCleaned = cleaned.toLowerCase();

    // Tier 1: exact match wins outright, before the cover/tribute filter.
    const exact = exactByLower.get(lowerCleaned);
    if (exact) return toMatch(exact);

    // Tier 2: whole-word cover/tribute-band filter.
    if (/\b(tribute|cover|soundalike)\b/i.test(lowerCleaned)) {
      return null;
    }

    // Tier 3: whole-word/whole-string substring match, most specific first.
    for (const e of bySubstring) {
      if (e.regex.test(cleaned) && e.name.length / cleaned.length >= MIN_SUBSTRING_COVERAGE) {
        return toMatch(e);
      }
    }

    // Tier 4: fuzzy fallback for near-miss scraping noise.
    const fuzzyHit = didYouMean(cleaned, fuzzyNames, {
      threshold: FUZZY_MAX_EDIT_DISTANCE,
      thresholdType: ThresholdTypeEnums.EDIT_DISTANCE
    });
    if (typeof fuzzyHit === 'string') {
      const hit = exactByLower.get(fuzzyHit.toLowerCase());
      if (hit) return toMatch(hit);
    }

    return null;
  };
}

/**
 * Match a single scraped artist name against the approved list. Thin wrapper over
 * buildApprovedMatcher — prefer building the matcher once for batch processing.
 */
export function matchApprovedArtist(scrapedName: string, approvedArtists: any[]): ArtistMatch | null {
  return buildApprovedMatcher(approvedArtists)(scrapedName);
}

/**
 * Parse date strings into standard ISO YYYY-MM-DD
 */
/** True if a YYYY-MM-DD string represents a real calendar date (not e.g. the
 * invalid-but-shape-valid "2026-17-09" a day/month mix-up could produce --
 * ConcertSchema's own date regex only checks digit shape, not calendar validity). */
function isCalendarValidIso(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, d] = m;
  const roundtrip = new Date(Number(y), Number(mo) - 1, Number(d));
  return roundtrip.getFullYear() === Number(y) && roundtrip.getMonth() === Number(mo) - 1 && roundtrip.getDate() === Number(d);
}

export function parseDate(dateStr: string, baseDateStr: string): string | null {
  const result = parseDateUnchecked(dateStr, baseDateStr);
  // Final safety net regardless of which branch below produced the result: a
  // date that isn't a real calendar date must never reach ConcertSchema, which
  // would accept it (its regex only checks digit shape, e.g. "2026-17-09" passes).
  if (result !== null && !isCalendarValidIso(result)) return null;
  return result;
}

function parseDateUnchecked(dateStr: string, baseDateStr: string): string | null {
  const cleanStr = dateStr.toLowerCase().trim().replace(/,/g, '').replace(/\//g, '.');
  const baseDate = new Date(baseDateStr);
  const baseYear = baseDate.getFullYear();

  // Relative dates
  if (cleanStr === 'today' || cleanStr === 'heute') {
    return baseDate.toISOString().slice(0, 10);
  }
  if (cleanStr === 'tomorrow' || cleanStr === 'morgen') {
    const tomorrow = new Date(baseDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  // Month mappings (English, German, Dutch, Serbian-Latin)
  const MONTHS: Record<string, string> = {
    jan: '01', januar: '01', january: '01', januari: '01',
    feb: '02', februar: '02', february: '02', februari: '02',
    mrz: '03', märz: '03', mar: '03', march: '03', mart: '03', maart: '03',
    apr: '04', april: '04',
    mai: '05', may: '05', mei: '05', maj: '05',
    jun: '06', juni: '06', june: '06',
    jul: '07', juli: '07', july: '07',
    aug: '08', august: '08', avgust: '08', augustus: '08',
    sep: '09', september: '09', septembar: '09',
    okt: '10', oktober: '10', oct: '10', october: '10', oktobar: '10',
    nov: '11', november: '11', novembar: '11',
    dez: '12', dezember: '12', dec: '12', december: '12', decembar: '12',
    // Spanish (Medellin/Barcelona/Mexico City/Cartagena/etc. all render dates
    // this way, e.g. "8 de julio de 2026" -- see the dedicated pattern below).
    ene: '01', enero: '01',
    febrero: '02',
    marzo: '03',
    abr: '04', abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    ago: '08', agosto: '08',
    septiembre: '09', setiembre: '09',
    octubre: '10',
    noviembre: '11',
    dic: '12', diciembre: '12'
  };

  // Spanish "D de Month de YYYY" / "D de Month" -- the connector words ("de")
  // mean this doesn't fit the generic "D Month[ YYYY]" patterns below even once
  // the month name itself is recognized, so it needs its own explicit branch.
  const esWithYear = cleanStr.match(/^(\d{1,2})\s+de\s+([a-zà-ÿ]+)\s+de\s+(\d{4})$/);
  if (esWithYear) {
    const month = MONTHS[esWithYear[2]];
    if (month) return `${esWithYear[3]}-${month}-${esWithYear[1].padStart(2, '0')}`;
  }
  const esNoYear = cleanStr.match(/^(\d{1,2})\s+de\s+([a-zà-ÿ]+)$/);
  if (esNoYear) {
    const month = MONTHS[esNoYear[2]];
    if (month) return resolveYearless(month, esNoYear[1].padStart(2, '0'), baseDate);
  }

  // 1. YYYY-MM-DD
  const isoMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. DD.MM.YYYY or DD.MM.YY (some sites, e.g. Sagres Campo Pequeno's calendar
  // widget, actually render MM.DD.YYYY -- if the second number can't be a month
  // (>12), swap positions rather than emit a garbage date like "2026-17-09" that
  // still passes ConcertSchema's shape-only date regex).
  const dotMatch = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotMatch) {
    let [_, first, second, year] = dotMatch;
    let day = first;
    let month = second;
    if (Number(second) > 12 && Number(first) <= 12) {
      day = second;
      month = first;
    }
    day = day.padStart(2, '0');
    month = month.padStart(2, '0');
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }

  // 3. DD.MM. (No year)
  const dotNoYearMatch = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (dotNoYearMatch) {
    let [_, day, month] = dotNoYearMatch;
    day = day.padStart(2, '0');
    month = month.padStart(2, '0');
    return resolveYearless(month, day, baseDate);
  }

  // 4. DD Month YYYY (e.g. 12. Okt 2026 or 12 Oktober 2026 or 12 Oct 2026)
  const cleanSpaced = cleanStr.replace(/^(\d{1,2})\./, '$1');
  const dMonthYMatch = cleanSpaced.match(/^(\d{1,2})\s+([a-zäöüß]+)\s+(\d{4})$/);
  if (dMonthYMatch) {
    let [_, day, monthStr, year] = dMonthYMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 5. Month DD YYYY (e.g. Oct 12 2026 or October 12 2026)
  const monthDYMatch = cleanSpaced.match(/^([a-zäöüß]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (monthDYMatch) {
    let [_, monthStr, day, year] = monthDYMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 6. DD Month (No year, e.g. 12. Okt or 12 Oct)
  const dMonthMatch = cleanSpaced.match(/^(\d{1,2})\s+([a-zäöüß]+)$/);
  if (dMonthMatch) {
    let [_, day, monthStr] = dMonthMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return resolveYearless(month, day, baseDate);
    }
  }

  // 7. Month DD (No year, e.g. Oct 12)
  const monthDMatch = cleanSpaced.match(/^([a-zäöüß]+)\s+(\d{1,2})$/);
  if (monthDMatch) {
    let [_, monthStr, day] = monthDMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return resolveYearless(month, day, baseDate);
    }
  }

  // 8. Raw ISO datetime prefix (e.g. "2026-07-08 00:00:00" or "2026-07-06T21:00:00.000000Z").
  // Handled as a plain string slice (not Date.parse) to avoid timezone-shift off-by-one errors.
  const isoPrefixMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefixMatch) {
    return isoPrefixMatch[1];
  }

  // 9. Loose extraction: find "D Month[ - D Month] YYYY" anywhere in noisy text (weekday name
  // prefixes, trailing time/price suffixes, multi-day ranges) instead of requiring an exact match.
  const looseWithYear = cleanStr.match(/(\d{1,2})\.?\s+([a-zäöüß]+)\.?(?:\s*-\s*\d{1,2}\.?\s+[a-zäöüß]+\.?)?\s+(\d{4})\b/);
  if (looseWithYear) {
    const month = MONTHS[looseWithYear[2]];
    if (month) {
      return `${looseWithYear[3]}-${month}-${looseWithYear[1].padStart(2, '0')}`;
    }
  }

  // 10. Same as above but with no year present anywhere (rolls forward to next occurrence).
  if (!/\d{4}/.test(cleanStr)) {
    const looseNoYear = cleanStr.match(/(\d{1,2})(?:\s*-\s*\d{1,2})?\.?\s+([a-zäöüß]+)\b/);
    if (looseNoYear) {
      const month = MONTHS[looseNoYear[2]];
      if (month) {
        return resolveYearless(month, looseNoYear[1].padStart(2, '0'), baseDate);
      }
    }
  }

  // 11. chrono-node: multilingual/natural-language fallback for noisy formats the
  // regex ladder misses (weekday prefixes, ordinals, ranges). forwardDate resolves
  // a bare month/day into the future rather than the past.
  try {
    const results = chrono.parse(dateStr, baseDate, { forwardDate: true });
    if (results.length > 0) {
      return toLocalIso(results[0].start.date());
    }
  } catch {
    // chrono failure is non-fatal; fall through.
  }

  // 12. Last resort: the platform date parser.
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Build a consistent artistSocials object: keep only present links, drop empties,
 * and return undefined when there are none — so downstream consumers see one shape
 * (present keys only) rather than a mix of empty strings and omitted keys.
 */
function buildArtistSocials(socials: any): Concert['artistSocials'] {
  if (!socials || typeof socials !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of ['spotify', 'instagram', 'facebook', 'youtube', 'telegram', 'vk'] as const) {
    if (socials[key]) out[key] = socials[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalizes and processes raw scraped concerts, filters out non-approved artists,
 * standardizes dates, and deduplicates.
 */
export async function processConcerts(
  rawConcerts: Partial<Concert>[],
  approvedArtistsPath: string,
  baseDateStr: string = new Date().toISOString()
): Promise<Concert[]> {
  let approvedArtists: any[] = [];
  try {
    const data = await fs.readFile(approvedArtistsPath, 'utf-8');
    approvedArtists = JSON.parse(data);
  } catch (err: any) {
    console.warn(`[Pipeline] Could not load approved artists list. Proceeding with empty list: ${err.message}`);
  }

  // Compile the matcher once for the whole batch instead of per concert.
  const match = buildApprovedMatcher(approvedArtists);
  const processedMap = new Map<string, Concert>();
  // Telemetry: why events are dropped, so silent losses are visible.
  const drops = { incomplete: 0, notApproved: 0, badDate: 0, zodFail: 0 };

  for (const raw of rawConcerts) {
    if (!raw.artist || !raw.date || !raw.venue || !raw.city || !raw.country || !raw.originalSource || !raw.scrapedAt) {
      drops.incomplete++;
      continue;
    }

    // 1. Artist Normalization & Filter
    const matched = match(raw.artist);
    if (!matched) {
      drops.notApproved++;
      continue;
    }

    // 2. Date Parsing
    const normalizedDate = parseDate(raw.date, baseDateStr);
    if (!normalizedDate) {
      drops.badDate++;
      continue;
    }

    // Prepare full concert model
    const concertData: Concert = {
      artist: matched.name,
      artistWebsite: matched.website || undefined,
      artistSocials: buildArtistSocials(matched.socials),
      date: normalizedDate,
      venue: raw.venue.trim(),
      city: raw.city.trim(),
      country: normalizeCountry(raw.country),
      lat: raw.lat,
      lng: raw.lng,
      ticketUrl: raw.ticketUrl ? raw.ticketUrl.trim() : undefined,
      originalSource: raw.originalSource,
      scrapedAt: raw.scrapedAt
    };

    // Validate using Zod
    const validation = ConcertSchema.safeParse(concertData);
    if (!validation.success) {
      drops.zodFail++;
      console.warn(`[Pipeline] Concert failed Zod validation for "${concertData.artist}":`, validation.error.issues.map((i) => i.message).join('; '));
      continue;
    }

    const validatedConcert = validation.data;

    // 3. Deduplication Key: (artist_slug, date, city_slug)
    const artistSlug = slugify(validatedConcert.artist);
    const citySlug = slugify(validatedConcert.city);
    const dedupeKey = `${artistSlug}_${validatedConcert.date}_${citySlug}`;

    if (processedMap.has(dedupeKey)) {
      const existing = processedMap.get(dedupeKey)!;
      // Merge: prefer record with a ticketUrl
      if (!existing.ticketUrl && validatedConcert.ticketUrl) {
        processedMap.set(dedupeKey, validatedConcert);
      }
    } else {
      processedMap.set(dedupeKey, validatedConcert);
    }
  }

  const kept = processedMap.size;
  const totalDropped = drops.incomplete + drops.notApproved + drops.badDate + drops.zodFail;
  console.log(
    `[Pipeline] ${rawConcerts.length} raw -> ${kept} valid events. ` +
    `Dropped ${totalDropped}: ${drops.notApproved} not-approved, ${drops.badDate} bad-date, ${drops.incomplete} incomplete, ${drops.zodFail} zod-fail.`
  );

  return Array.from(processedMap.values());
}
