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
 * Deterministic fallback for a name with no letters/digits at all (rare -- a
 * purely symbolic stage name). A fixed placeholder would collide every such
 * name into the same slug, exactly the bug this is a fallback FOR, so this
 * hashes the original string instead -- distinct symbolic names still get
 * distinct, stable slugs.
 */
function fallbackSlugHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Generates a slug for deduplication index keys and per-artist/city filenames
 * (e.g. "The Cure" -> "the-cure"). Keeps any script's actual letters/digits
 * (\p{L}/\p{N}, Unicode-aware) rather than only ASCII \w -- a name that's
 * partially or entirely non-Latin (Cyrillic, CJK, etc.) used to have every
 * such character silently stripped, which for a name with NO Latin characters
 * at all collapsed to an empty string. Confirmed live against
 * data/approved_artists.json: 374 distinct slug collisions (847 artist names)
 * before this fix, 91 of them colliding into a literal empty slug (e.g. "\u0410\u043b\u043b\u0430
 * \u041f\u0443\u0433\u0430\u0447\u0451\u0432\u0430", "\u0410\u043d\u0442\u043e\u0445\u0430 \u041c\u0421") -- real coverage gaps since Bandsintown's worldwide
 * sweep specifically targets RU-market artists (see BACKLOG.md).
 */
export function slugify(str: string): string {
  const slug = str
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'') // strip combining diacritics (Z\u00fcrich -> zurich)
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // drop punctuation/symbols; keep letters/digits from ANY script
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `artist-${fallbackSlugHash(str)}`;
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
 * a real approved artist) isn't mistaken for one and truncated. "Live in
 * <city>" (no leading hyphen -- a common tour-page template, e.g. "AZ Live in
 * Berlin") needs its own pattern since it isn't hyphen-led; requiring a space
 * before "Live" means a bare "Live" (a real approved artist) is untouched.
 */
export function cleanArtistName(name: string): string {
  return name
    .replace(/\s+-\s*sold\s*out\b/gi, '')
    .replace(/\s*\(sold\s*out\)/gi, '')
    .replace(/\s+-\s*live\b.*/gi, '')
    .replace(/\s+live\s+in\s+.+$/gi, '')
    .replace(/\s+-\s*special\s*guest\b.*/gi, '')
    .replace(/\s+-\s*tour\b.*/gi, '')
    .replace(/\s*\(support\)/gi, '')
    .replace(/\s*\(live\)/gi, '')
    .trim();
}

export type ArtistMatch = { name: string; website?: string | null; socials?: any; mbid?: string | null };
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
 * True if the substring match at [matchIndex, matchIndex+matchLength) in `text`
 * has another capitalized word directly attached via a single space on either
 * side -- a strong signal the match is only a fragment of a longer, different
 * proper-noun phrase, not a real standalone hit. Found live in production:
 * "Baby" absorbing "Baby Keem", "Anonymous" absorbing "Joy Anonymous", "Band"
 * absorbing "Gilla Band", "Live" absorbing "Peter Kay Live" -- in every case the
 * true (longer, more specific) name simply wasn't itself in the approved list.
 */
function hasAttachedCapitalizedNeighbor(text: string, matchIndex: number, matchLength: number): boolean {
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchLength);
  const beforeWord = before.match(/([A-Za-z][\w']*)\s$/);
  if (beforeWord && /^[A-Z]/.test(beforeWord[1])) return true;
  return /^\s[A-Z]/.test(after);
}

// Phrase-joining words. A substring match glued to one of these is almost always a
// fragment of a longer title, not the artist -- e.g. "Fire" in "Wall of Fire", "Love"
// in "Songs of Love". Deliberately excludes locational prepositions (at/in/on) so a
// legitimate "Artist at Venue" / "Artist in City" listing still matches.
const PHRASE_CONNECTORS = new Set(['of', 'the', 'and', '&', 'vs', 'feat', 'feat.', 'featuring', 'ft', 'ft.', 'with', 'presents']);

/**
 * True if the match is directly glued to a phrase-connector word on either side
 * ("... of <match>", "<match> of ..."), signalling it's a sub-phrase of a longer
 * title rather than a standalone artist name.
 */
function hasAttachedConnectorNeighbor(text: string, matchIndex: number, matchLength: number): boolean {
  const before = text.slice(0, matchIndex);
  const after = text.slice(matchIndex + matchLength);
  const beforeWord = before.match(/([A-Za-z.&']+)\s$/);
  if (beforeWord && PHRASE_CONNECTORS.has(beforeWord[1].toLowerCase())) return true;
  const afterWord = after.match(/^\s([A-Za-z.&']+)/);
  if (afterWord && PHRASE_CONNECTORS.has(afterWord[1].toLowerCase())) return true;
  return false;
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
 *   3. Whole-word/whole-string substring match against only the FIRST clause of
 *      the title (split on " - ", the established artist-name-first convention
 *      this codebase already assumes elsewhere -- see cleanArtistName's suffix
 *      stripping), longest approved name first so a short generic entry ("alan")
 *      can never shadow a longer, more specific one ("Alan Walker") that also
 *      matches. Requires the matched name to cover a minimum fraction of that
 *      clause (MIN_SUBSTRING_COVERAGE) and rejects a match with an attached
 *      capitalized neighbor word (see hasAttachedCapitalizedNeighbor) -- real
 *      approved-artist entries that are also common dictionary words ("Music",
 *      "Band", "Live", "Darts", "Mega", "Queer", "Baby", "Anonymous", "Battery"
 *      were all found live in data/approved_artists.json) would otherwise match
 *      inside ANY unrelated event title or genre tag containing that word, or
 *      absorb a fragment of a longer real artist name that isn't itself approved
 *      -- confirmed against real scraped output, not hypothetical.
 *   4. Fuzzy fallback (edit-distance) for minor scraping noise tier 1-3 miss,
 *      scoped to the same first clause. Shorter names get a tighter tolerance --
 *      an edit distance of 2 is a much larger relative change on a 7-character
 *      name than a 15-character one ("Battery" wrongly absorbing "Baskery" was
 *      found live at exactly that distance).
 */

// A substring match only counts if the approved name makes up at least this
// fraction of the cleaned string -- otherwise a short dictionary-word artist
// name swallows unrelated non-music event titles that merely contain that word.
const MIN_SUBSTRING_COVERAGE = 0.25;

// Names at or under this length get the tighter tier-4 fuzzy tolerance. Kept
// narrow enough that a common single-transposition typo on a well-known
// 9-character name ("Rammstien" for "Rammstein", edit distance 2) still passes
// at the default tolerance -- only shorter names, where distance 2 is a much
// larger fraction of the string, get the stricter cutoff.
const FUZZY_SHORT_NAME_MAX = 7;
const FUZZY_SHORT_NAME_MAX_EDIT_DISTANCE = 1;

/** Bucket names by length so a length-windowed candidate lookup (see
 * candidatesNearLength) is O(window) map lookups instead of an O(m) scan. */
function bucketByLength(names: string[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const n of names) {
    const bucket = map.get(n.length);
    if (bucket) bucket.push(n);
    else map.set(n.length, [n]);
  }
  return map;
}

/** Edit distance can never be smaller than the two strings' length difference,
 * so any candidate outside [len-maxDist, len+maxDist] can never be within
 * maxDist -- collecting only those buckets is a lossless (zero false-negative)
 * way to shrink didyoumean2's candidate list before it computes real Levenshtein
 * distance against each one. */
function candidatesNearLength(byLength: Map<number, string[]>, len: number, maxDist: number): string[] {
  const out: string[] = [];
  for (let l = len - maxDist; l <= len + maxDist; l++) {
    const bucket = byLength.get(l);
    if (bucket) out.push(...bucket);
  }
  return out;
}

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
  const fuzzyNamesShort = longNames.filter((e) => e.name.length <= FUZZY_SHORT_NAME_MAX).map((e) => e.name);
  const fuzzyNamesLong = longNames.filter((e) => e.name.length > FUZZY_SHORT_NAME_MAX).map((e) => e.name);
  // ~62k-entry approved list, precomputed once per matcher build (not per event).
  const fuzzyShortByLength = bucketByLength(fuzzyNamesShort);
  const fuzzyLongByLength = bucketByLength(fuzzyNamesLong);

  const toMatch = (e: { name: string; approved: any }): ArtistMatch =>
    typeof e.approved === 'string'
      ? { name: e.name }
      : { name: e.approved.name, website: e.approved.website, socials: e.approved.socials, mbid: e.approved.mbid };

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

    // Tiers 3-4 only look at the first " - "-delimited clause -- a trailing
    // clause is a subtitle/venue/genre tag, not the artist name (the same
    // assumption cleanArtistName's suffix-stripping already makes explicit).
    const primaryClause = cleaned.split(/\s-\s/)[0];
    const lowerPrimaryClause = primaryClause.toLowerCase();

    // Tier 3: whole-word/whole-string substring match, most specific first.
    for (const e of bySubstring) {
      // Cheap native substring pre-check before the costlier \b-anchored regex --
      // provably safe: e.regex is just e's escaped text plus optional \b anchors,
      // so if it matches, e.lower must also appear literally inside
      // lowerPrimaryClause. At ~55k entries tested per event, .includes() (V8's
      // optimized native scan) rejecting most candidates outright, instead of
      // invoking the regex engine on every one, is the dominant cost of matching
      // an unapproved event -- confirmed live on a run where Ticketmaster's
      // broader raw-event volume made this stage take 15+ minutes.
      if (!lowerPrimaryClause.includes(e.lower)) continue;
      const match = e.regex.exec(primaryClause);
      if (
        match &&
        e.name.length / primaryClause.length >= MIN_SUBSTRING_COVERAGE &&
        !hasAttachedCapitalizedNeighbor(primaryClause, match.index, match[0].length) &&
        !hasAttachedConnectorNeighbor(primaryClause, match.index, match[0].length)
      ) {
        return toMatch(e);
      }
    }

    // Tier 4: fuzzy fallback for near-miss scraping noise. didyoumean2's default
    // returnType computes a real Levenshtein distance for every single candidate
    // with no length pruning of its own (checked its source) -- against the full
    // ~55k-name lists that was the single biggest cost of matching any event not
    // on the whitelist (the common case). candidatesNearLength shrinks that to
    // only the length-plausible names first (see its docstring for why that's
    // lossless), typically a few dozen names instead of tens of thousands.
    const clauseLen = primaryClause.length;
    const shortCandidates = candidatesNearLength(fuzzyShortByLength, clauseLen, FUZZY_SHORT_NAME_MAX_EDIT_DISTANCE);
    const longCandidates = candidatesNearLength(fuzzyLongByLength, clauseLen, FUZZY_MAX_EDIT_DISTANCE);
    const fuzzyHit =
      didYouMean(primaryClause, shortCandidates, {
        threshold: FUZZY_SHORT_NAME_MAX_EDIT_DISTANCE,
        thresholdType: ThresholdTypeEnums.EDIT_DISTANCE
      }) ??
      didYouMean(primaryClause, longCandidates, {
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

  // Month mappings (English, German, Dutch, Serbian-Latin, and Russian)
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
    // Spanish
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
    dic: '12', diciembre: '12',
    // Croatian
    siječnja: '01', veljače: '02', ožujka: '03', travnja: '04', svibnja: '05',
    lipnja: '06', srpnja: '07', kolovoza: '08', rujna: '09', listopada: '10',
    studenog: '11', studenoga: '11', prosinca: '12',
    // Russian
    январь: '01', января: '01',
    февраль: '02', февраля: '02',
    март: '03', марта: '03',
    апрель: '04', апреля: '04',
    май: '05', мая: '05',
    июнь: '06', июня: '06',
    июль: '07', июля: '07',
    август: '08', августа: '08',
    сентябрь: '09', сентября: '09',
    октябрь: '10', октября: '10',
    ноябрь: '11', ноября: '11',
    декабрь: '12', декабря: '12'
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
  const dMonthYMatch = cleanSpaced.match(/^(\d{1,2})\s+([a-zа-яёäöüß]+)\s+(\d{4})$/);
  if (dMonthYMatch) {
    let [_, day, monthStr, year] = dMonthYMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 5. Month DD YYYY (e.g. Oct 12 2026 or October 12 2026)
  const monthDYMatch = cleanSpaced.match(/^([a-zа-яёäöüß]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (monthDYMatch) {
    let [_, monthStr, day, year] = monthDYMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // 6. DD Month (No year, e.g. 12. Okt or 12 Oct)
  const dMonthMatch = cleanSpaced.match(/^(\d{1,2})\s+([a-zа-яёäöüß]+)$/);
  if (dMonthMatch) {
    let [_, day, monthStr] = dMonthMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return resolveYearless(month, day, baseDate);
    }
  }

  // 7. Month DD (No year, e.g. Oct 12)
  const monthDMatch = cleanSpaced.match(/^([a-zа-яёäöüß]+)\s+(\d{1,2})$/);
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
  const looseWithYear = cleanStr.match(/(\d{1,2})\.?\s+([a-zа-яёäöüß]+)\.?(?:\s*-\s*\d{1,2}\.?\s+[a-zа-яёäöüß]+\.?)?\s+(\d{4})\b/);
  if (looseWithYear) {
    const month = MONTHS[looseWithYear[2]];
    if (month) {
      return `${looseWithYear[3]}-${month}-${looseWithYear[1].padStart(2, '0')}`;
    }
  }

  // 10. Same as above but with no year present anywhere (rolls forward to next occurrence).
  if (!/\d{4}/.test(cleanStr)) {
    const looseNoYear = cleanStr.match(/(\d{1,2})(?:\s*-\s*\d{1,2})?\.?\s+([a-zа-яёäöüß]+)\b/);
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
  //
  // chrono is English-only, so on a genuinely foreign-language date (e.g. Croatian
  // "21. srpnja 2026. u 20:00") it can't understand the date part at all -- but it
  // WILL confidently latch onto a lone recognizable fragment like "20:00" and
  // silently default the missing date to baseDate ("today at 8pm"), producing a
  // plausible-looking but completely wrong result instead of failing. Require the
  // matched fragment to cover a meaningful share of the input before trusting it,
  // the same guard used for artist-name substring matches in matchApprovedArtist.
  const CHRONO_MIN_COVERAGE = 0.4;
  try {
    const results = chrono.parse(dateStr, baseDate, { forwardDate: true });
    // Require both a meaningful coverage AND a *certain* day or month component. A bare
    // time ("19:30", 100% coverage) or a lone weekday makes chrono default the missing
    // parts to baseDate ("today at 8pm") -- isCertain rejects that so we drop instead of
    // publishing a phantom concert dated today.
    if (
      results.length > 0 &&
      results[0].text.length / dateStr.trim().length >= CHRONO_MIN_COVERAGE &&
      results[0].start.isCertain('day') &&
      results[0].start.isCertain('month')
    ) {
      return toLocalIso(results[0].start.date());
    }
  } catch {
    // chrono failure is non-fatal; fall through.
  }

  // No parseable date. Deliberately NO Date.parse() last resort: it silently fabricates
  // plausible-but-wrong dates from foreign-language / marketing-copy strings (e.g.
  // Date.parse('12 Marta 2026') yields a real but wrong day). A clean null drop -- counted
  // by drops.badDate -- is always better than a confidently wrong date reaching users.
  return null;
}

/**
 * Extracts the Spotify artist ID from an `open.spotify.com/artist/<ID>` (or
 * `/intl-xx/artist/<ID>`) URL, no Spotify API call needed -- the ID is already
 * embedded in the social link enrichment already stores. Returns undefined for
 * any other shape (playlist/track/album links, or not a Spotify URL at all).
 */
export function parseSpotifyArtistId(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?artist\/([A-Za-z0-9]+)/);
  return match?.[1];
}

/**
 * Best-effort event start time (HH:MM), extracted only from an unambiguous ISO
 * datetime embedded in the raw date string (e.g. JSON-LD's startDate,
 * "2026-09-10T20:00:00"). Deliberately does NOT fall back to chrono-node here:
 * unlike parseDate (which already pays that cost once per event as a last
 * resort), running a second chrono pass over every single event just to grab a
 * time would double parsing cost for comparatively little gain -- most scraped
 * date strings without an embedded ISO time don't carry a reliably-attributable
 * time elsewhere in the string either.
 */
export function extractTimeFromRawDate(dateStr: string): string | undefined {
  const match = dateStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h > 23 || m > 59) return undefined;
  return `${match[1]}:${match[2]}`;
}

// Keyword -> coarse venue category. Order matters: checked top-to-bottom, first
// match wins, so more specific keywords (e.g. "amphitheatre") should stay ahead
// of anything that could also loosely match a broader bucket.
const VENUE_KIND_KEYWORDS: Array<[RegExp, Concert['venueKind']]> = [
  [/\bstadium\b/i, 'stadium'],
  [/\b(arena|amphitheatre|amphitheater)\b/i, 'arena'],
  [/\b(open\s*air|festival\s*ground|park|beach)\b/i, 'open-air'],
  [/\b(theatre|theater|opera|philharmonic)\b/i, 'theatre'],
  [/\b(club|bar|pub|lounge)\b/i, 'club'],
  [/\b(hall|hangar|centre|center|saal)\b/i, 'hall']
];

/**
 * Infers a coarse venue category from the venue name's own text -- a cheap,
 * always-available substitute for a full street address (which the north-star
 * flow doesn't actually need; see BACKLOG.md Tier 3). Returns undefined rather
 * than 'other' when nothing matches, so a genuinely unclassified venue doesn't
 * masquerade as a confident "other" classification versus "we don't know".
 */
export function inferVenueKind(venueName: string): Concert['venueKind'] | undefined {
  for (const [pattern, kind] of VENUE_KIND_KEYWORDS) {
    if (pattern.test(venueName)) return kind;
  }
  return undefined;
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
  baseDateStr: string = new Date().toISOString(),
  // Lets a caller that already needs the parsed whitelist for something else
  // (e.g. publishArtistCatalog) capture it from this call instead of paying for
  // its own separate read+parse of the same ~63k-entry file right afterward.
  onApprovedArtistsLoaded?: (approvedArtists: any[]) => void
): Promise<Concert[]> {
  let approvedArtists: any[] = [];
  try {
    const data = await fs.readFile(approvedArtistsPath, 'utf-8');
    approvedArtists = JSON.parse(data);
  } catch (err: any) {
    console.warn(`[Pipeline] Could not load approved artists list. Proceeding with empty list: ${err.message}`);
  }
  onApprovedArtistsLoaded?.(approvedArtists);

  // Compile the matcher once for the whole batch instead of per concert.
  const match = buildApprovedMatcher(approvedArtists);
  const processedMap = new Map<string, Concert>();
  // Telemetry: why events are dropped, so silent losses are visible.
  const drops = { incomplete: 0, notApproved: 0, badDate: 0, pastDate: 0, zodFail: 0 };
  // Some venue pages list past shows alongside upcoming ones (an archive
  // section the scraper's selector also happens to pick up); nothing should
  // ever publish a concert that's already happened.
  const todayIso = toLocalIso(new Date(baseDateStr));

  // Periodic progress logging: whitelist-matching a big raw batch (e.g. a
  // Ticketmaster-boosted run) against ~62k approved entries can take long enough
  // that a CI job with no output in between looks hung rather than working --
  // observed live. Time-based (not count-based) so it stays informative
  // regardless of how the per-event cost changes.
  const matchStart = Date.now();
  let lastProgressLogAt = matchStart;
  const total = rawConcerts.length;
  let processed = 0;

  for (const raw of rawConcerts) {
    processed++;
    const now = Date.now();
    if (now - lastProgressLogAt >= 5000) {
      console.log(`[Pipeline] Matching progress: ${processed}/${total} raw events (${((now - matchStart) / 1000).toFixed(1)}s elapsed)...`);
      lastProgressLogAt = now;
    }

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
    if (normalizedDate < todayIso) {
      drops.pastDate++;
      continue;
    }

    // Prepare full concert model
    const artistSocials = buildArtistSocials(matched.socials);
    const concertData: Concert = {
      artist: matched.name,
      artistWebsite: matched.website || undefined,
      artistSocials,
      spotifyId: parseSpotifyArtistId(artistSocials?.spotify),
      mbid: matched.mbid || undefined,
      date: normalizedDate,
      startTime: raw.startTime || extractTimeFromRawDate(raw.date),
      venue: raw.venue.trim(),
      venueKind: inferVenueKind(raw.venue),
      city: raw.city.trim(),
      country: normalizeCountry(raw.country),
      lat: raw.lat,
      lng: raw.lng,
      festival: raw.festival,
      lineup: raw.lineup,
      priceRange: raw.priceRange,
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
  const totalDropped = drops.incomplete + drops.notApproved + drops.badDate + drops.pastDate + drops.zodFail;
  console.log(
    `[Pipeline] ${rawConcerts.length} raw -> ${kept} valid events. ` +
    `Dropped ${totalDropped}: ${drops.notApproved} not-approved, ${drops.badDate} bad-date, ` +
    `${drops.pastDate} past-date, ${drops.incomplete} incomplete, ${drops.zodFail} zod-fail.`
  );

  return Array.from(processedMap.values());
}
