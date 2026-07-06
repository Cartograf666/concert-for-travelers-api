import * as fs from 'fs/promises';
import * as path from 'path';
import { Concert, ConcertSchema } from '../schemas/concert.js';

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

/**
 * Match a scraped artist name against the approved list, filter out tribute/cover bands
 */
export function matchApprovedArtist(scrapedName: string, approvedArtists: any[]): { name: string; website?: string } | null {
  const cleaned = cleanArtistName(scrapedName);
  
  // If it's a cover band or tribute night, filter it out
  const lowerCleaned = cleaned.toLowerCase();
  if (
    lowerCleaned.includes('tribute') ||
    lowerCleaned.includes('cover') ||
    lowerCleaned.includes('soundalike')
  ) {
    return null;
  }

  for (const approved of approvedArtists) {
    const approvedName = typeof approved === 'string' ? approved : approved.name;
    const escaped = escapeRegExp(approvedName);
    // Matches as whole words, e.g. "The Cure" matches "The Cure in Berlin" but not "The Cured"
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(cleaned)) {
      return typeof approved === 'string' 
        ? { name: approved } 
        : { name: approved.name, website: approved.website, socials: approved.socials };
    }
  }

  return null;
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

  // Month mappings (English & German)
  const MONTHS: Record<string, string> = {
    jan: '01', januar: '01', january: '01',
    feb: '02', februar: '02', february: '02',
    mrz: '03', märz: '03', mar: '03', march: '03',
    apr: '04', april: '04',
    mai: '05', may: '05',
    jun: '06', juni: '06', june: '06',
    jul: '07', juli: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    okt: '10', oktober: '10', oct: '10', october: '10',
    nov: '11', november: '11',
    dez: '12', dezember: '12', dec: '12', december: '12'
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
    return `${baseYear}-${month}-${day}`;
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
      return `${baseYear}-${month}-${day}`;
    }
  }

  // 7. Month DD (No year, e.g. Oct 12)
  const monthDMatch = cleanSpaced.match(/^([a-zäöüß]+)\s+(\d{1,2})$/);
  if (monthDMatch) {
    let [_, monthStr, day] = monthDMatch;
    const month = MONTHS[monthStr];
    if (month) {
      day = day.padStart(2, '0');
      return `${baseYear}-${month}-${day}`;
    }
  }

  // Fallback try standard parser
  const parsed = Date.parse(dateStr);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  return null;
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

  const processedMap = new Map<string, Concert>();

  for (const raw of rawConcerts) {
    if (!raw.artist || !raw.date || !raw.venue || !raw.city || !raw.country || !raw.originalSource || !raw.scrapedAt) {
      // Skip incomplete scraped values
      continue;
    }

    // 1. Artist Normalization & Filter
    const matched = matchApprovedArtist(raw.artist, approvedArtists);
    if (!matched) {
      // Filter out if not approved or represents a tribute band
      continue;
    }

    // 2. Date Parsing
    const normalizedDate = parseDate(raw.date, baseDateStr);
    if (!normalizedDate) {
      // Skip if date format cannot be resolved
      continue;
    }

    // Prepare full concert model
    const concertData: Concert = {
      artist: matched.name,
      artistWebsite: matched.website || undefined,
      artistSocials: matched.socials ? {
        spotify: matched.socials.spotify || undefined,
        instagram: matched.socials.instagram || undefined,
        facebook: matched.socials.facebook || undefined,
        youtube: matched.socials.youtube || undefined,
        telegram: matched.socials.telegram || undefined,
        vk: matched.socials.vk || undefined
      } : undefined,
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
      console.warn(`[Pipeline] Concert failed Zod validation:`, validation.error.format());
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

  return Array.from(processedMap.values());
}
