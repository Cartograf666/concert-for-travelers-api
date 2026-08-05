import * as fs from 'fs/promises';
import getGeocoder from 'node-geocoder';
import { hasUnreadableScript, isReadableScript } from './script.js';
import { Concert } from '../schemas/concert.js';
import { sleep } from '../engine/sleep.js';

/**
 * Fills lat/lng on every concert that's missing them, so "near where I'll be"
 * never silently breaks just because a source didn't supply coordinates (an
 * artist tour-page scraper's per-row venue, or any static scraper before its
 * one-time geocode_venues.ts pass). Ticketmaster/Bandsintown already carry
 * lat/lng from their own APIs and are left untouched.
 *
 * Deliberately NOT run inside processConcerts: that function is pure (no
 * network calls) and the test suite calls it directly -- geocoding lives here,
 * as a separate best-effort orchestrator step, so unit tests never hit a real
 * geocoding API. "Guaranteed" means "always attempted, cached forever once
 * resolved" rather than a hard schema requirement -- a venue name Nominatim
 * genuinely can't resolve must not fail the whole pipeline.
 */

// Nominatim's usage policy caps bulk/automated use at 1 request/second and asks
// for an identifying contact -- same constraint geocode_venues.ts already follows.
const NOMINATIM_RATE_LIMIT_MS = 1100;

// Per-run cap so a first run (or a sudden influx of new venues, e.g. the
// Bandsintown worldwide sweep) can't blow the daily job's time budget on one
// go -- same "batched across successive runs" shape as the Bandsintown sweep
// and the Wikidata-bulk enrichment pass. The persistent cache means the pending
// set shrinks permanently, run over run.
const DEFAULT_MAX_PER_RUN = 400;

export interface GeocodeCacheEntry {
  lat: number | null; // null = tried, Nominatim had no result -- don't retry every run
  lng: number | null;
  geocodedAt: string;
  /**
   * The place name Nominatim returns under `accept-language: en`, when it has one.
   * Absent on entries written before this existed; `null` means Nominatim answered
   * but named no locality. Free: the same lookup already being made for lat/lng
   * carries it, so no extra request is issued to obtain an English city name.
   */
  cityEn?: string | null;
}
export type GeocodeCache = Record<string, GeocodeCacheEntry>;

export async function loadGeocodeCache(cachePath: string): Promise<GeocodeCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveGeocodeCache(cachePath: string, cache: GeocodeCache): Promise<void> {
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/** Cache key: normalized venue+city+country -- the same physical venue across
 * many concerts/runs costs Nominatim exactly one lookup, ever. */
export function geocodeCacheKey(concert: Pick<Concert, 'venue' | 'city' | 'country'>): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(concert.venue)}|${norm(concert.city)}|${norm(concert.country)}`;
}

export type GeocodeFn = (query: string) => Promise<{ lat: number; lng: number; cityEn?: string | null } | null>;

function defaultGeocodeFn(): GeocodeFn {
  const email = process.env.NOMINATIM_EMAIL;
  if (!email) {
    console.warn(
      '[Geocode] NOMINATIM_EMAIL is not set. Nominatim\'s usage policy asks for an ' +
      'identifying contact for automated use -- set it to a real address before running this at scale.'
    );
  }
  // `language: 'en'` costs nothing and answers a question the scrapers cannot:
  // a Japanese venue page yields a Japanese city string, and no amount of
  // reconciling sources helps when every source spells it the same unreadable
  // way. Nominatim holds the English exonym and returns it on the very request
  // this pass already makes for lat/lng.
  const base = { provider: 'openstreetmap' as const, language: 'en' };
  const geocoder = getGeocoder(email ? { ...base, email } : base);
  return async (query: string) => {
    const results = await geocoder.geocode(query);
    const r = results[0];
    if (!r || r.latitude === undefined || r.longitude === undefined) {
      return null;
    }
    // Nominatim's own hierarchy: `city` when it has one, else the next-widest
    // locality it does have. `state` is deliberately last -- better a region name
    // the reader can read than a city name they cannot.
    const loose = r as unknown as Record<string, string | undefined>;
    const cityEn = r.city || loose.town || loose.village || loose.state || null;
    return { lat: r.latitude, lng: r.longitude, cityEn };
  };
}

export interface GeocodeConcertsOptions {
  cache?: GeocodeCache;
  maxPerRun?: number;
  geocodeFn?: GeocodeFn;
  delayMs?: number;
}

export interface GeocodeStats {
  attempted: number; // fresh Nominatim lookups actually issued this run
  filledFromCache: number; // lat/lng filled from a prior run's (or this run's) cache hit
  geocoded: number; // fresh lookups that resolved
  failed: number; // fresh lookups that errored or found nothing
  skippedCapped: number; // left ungeocoded this run because maxPerRun was hit
  cityTranslated: number; // unreadable city strings replaced with Nominatim's English name
}

/**
 * Mutates `concerts` in place, filling lat/lng wherever missing. `cache` is
 * mutated in place too (same "caller loads, passes in, saves after" shape as
 * every other cache in this codebase) so a repeat venue is geocoded at most once
 * across the whole project's lifetime, not once per run.
 */
export async function geocodeConcerts(concerts: Concert[], options: GeocodeConcertsOptions = {}): Promise<GeocodeStats> {
  const cache = options.cache ?? {};
  const maxPerRun = options.maxPerRun ?? DEFAULT_MAX_PER_RUN;
  const geocodeFn = options.geocodeFn ?? defaultGeocodeFn();
  const delayMs = options.delayMs ?? NOMINATIM_RATE_LIMIT_MS;

  const stats: GeocodeStats = { attempted: 0, filledFromCache: 0, geocoded: 0, failed: 0, skippedCapped: 0, cityTranslated: 0 };

  for (const concert of concerts) {
    if (!concert.venue || !concert.city || !concert.country) continue;

    const key = geocodeCacheKey(concert);
    const cached = cache[key];
    const needsCoords = concert.lat === undefined || concert.lng === undefined;
    // A city string in a script the feed's readers cannot read is worth a lookup
    // even when coordinates are already known -- most concerts carry lat/lng from
    // their scraper config and would otherwise never be offered an English name.
    // Entries cached before cityEn existed have `undefined` here, so they are
    // retried once; entries that came back with `null` are not asked again.
    const needsCityEn = hasUnreadableScript(concert.city) && cached?.cityEn === undefined;
    if (!needsCoords && !needsCityEn) continue;

    if (cached && !needsCityEn) {
      stats.filledFromCache++;
      if (cached.lat !== null && cached.lng !== null) {
        concert.lat = cached.lat;
        concert.lng = cached.lng;
      }
      applyEnglishCity(concert, cached.cityEn, stats);
      continue;
    }

    if (stats.attempted >= maxPerRun) {
      stats.skippedCapped++;
      continue; // not cached -> still pending, retried next run
    }

    stats.attempted++;
    const query = `${concert.venue}, ${concert.city}, ${concert.country}`;
    try {
      const result = await geocodeFn(query);
      const geocodedAt = new Date().toISOString();
      if (result) {
        concert.lat = result.lat;
        concert.lng = result.lng;
        cache[key] = { lat: result.lat, lng: result.lng, geocodedAt, cityEn: result.cityEn ?? null };
        applyEnglishCity(concert, result.cityEn ?? null, stats);
        stats.geocoded++;
      } else {
        cache[key] = { lat: null, lng: null, geocodedAt, cityEn: null }; // known-unresolvable -- don't retry every run
        stats.failed++;
      }
    } catch (err: any) {
      // Network/transient error -- deliberately NOT cached, so it's retried next run.
      console.warn(`[Geocode] "${query}" failed: ${err.message}`);
      stats.failed++;
    }

    if (stats.attempted < maxPerRun) await sleep(delayMs);
  }

  return stats;
}

/**
 * Replaces an unreadable city string with Nominatim's English name for the same
 * point. Deliberately one-directional: a city the reader can already read is left
 * exactly as scraped, because Nominatim often answers with a ward or suburb
 * ("Shibuya City" for a venue in Tokyo) and overwriting good data with a narrower
 * name would be a downgrade. The publisher's geo-clustering already reconciles
 * those; this only fills the case where clustering has nothing readable to pick.
 */
function applyEnglishCity(concert: Concert, cityEn: string | null | undefined, stats: GeocodeStats): void {
  if (!cityEn || !hasUnreadableScript(concert.city)) return;
  if (!isReadableScript(cityEn)) return; // Nominatim answered in the local script anyway
  concert.city = cityEn;
  stats.cityTranslated++;
}
