import * as fs from 'fs/promises';
import * as path from 'path';
import * as chrono from 'chrono-node';
import { Concert, ConcertSchema } from '../schemas/concert.js';

/** Format a Date as a timezone-safe YYYY-MM-DD using its local calendar fields. */
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
 * Clean common suffixes/prefixes from artist names
 */
export function cleanArtistName(name: string): string {
  return name
    .replace(/\s*-\s*sold\s*out\b/gi, '')
    .replace(/\s*\(sold\s*out\)/gi, '')
    .replace(/\s*-\s*live\b.*/gi, '')
    .replace(/\s*-\s*special\s*guest\b.*/gi, '')
    .replace(/\s*-\s*tour\b.*/gi, '')
    .replace(/\s*\(support\)/gi, '')
    .replace(/\s*\(live\)/gi, '')
    .trim();
}

export type ArtistMatch = { name: string; website?: string | null; socials?: any };
export type ApprovedMatcher = (scrapedName: string) => ArtistMatch | null;

// Names this short are matched only by exact equality, never as a whole-word
// substring — otherwise "10cc"/"M83"/two-letter names hit inside unrelated titles.
const SHORT_NAME_MAX = 3;

/**
 * Precompile the approved-artist list into a fast reusable matcher. Regexes are
 * built ONCE here instead of once per scraped concert (the list is ~62k entries
 * and the pipeline runs twice), which is the bulk of the matching cost.
 */
export function buildApprovedMatcher(approvedArtists: any[]): ApprovedMatcher {
  const compiled = approvedArtists.map((approved) => {
    const name: string = typeof approved === 'string' ? approved : approved?.name ?? '';
    const short = name.length <= SHORT_NAME_MAX;
    return {
      approved,
      name,
      lower: name.toLowerCase(),
      // Whole-word match ("The Cure" matches "The Cure in Berlin" but not "The Cured").
      regex: short ? null : new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')
    };
  });

  return (scrapedName: string): ArtistMatch | null => {
    const cleaned = cleanArtistName(scrapedName);
    const lowerCleaned = cleaned.toLowerCase();

    // Filter out cover bands / tribute nights.
    if (lowerCleaned.includes('tribute') || lowerCleaned.includes('cover') || lowerCleaned.includes('soundalike')) {
      return null;
    }

    for (const c of compiled) {
      if (!c.name) continue;
      const hit = c.regex ? c.regex.test(cleaned) : lowerCleaned === c.lower;
      if (hit) {
        return typeof c.approved === 'string'
          ? { name: c.name }
          : { name: c.approved.name, website: c.approved.website, socials: c.approved.socials };
      }
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
export function parseDate(dateStr: string, baseDateStr: string): string | null {
  const cleanStr = dateStr.toLowerCase().trim().replace(/,/g, '');
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
    dez: '12', dezember: '12', dec: '12', december: '12', decembar: '12'
  };

  // 1. YYYY-MM-DD
  const isoMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. DD.MM.YYYY or DD.MM.YY
  const dotMatch = cleanStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotMatch) {
    let [_, day, month, year] = dotMatch;
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
      country: raw.country.trim().toUpperCase(),
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
