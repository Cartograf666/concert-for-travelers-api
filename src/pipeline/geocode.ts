import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { hasUnreadableScript, isReadableScript } from './script.js';
import { Concert } from '../schemas/concert.js';
import { sleep } from '../engine/sleep.js';

/** The project's scheduled Nominatim policy is at most four requests per minute;
 * the daily reader is deliberately cache-only. */
export const NOMINATIM_RATE_LIMIT_MS = 15_100;
export const NOMINATIM_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_PER_RUN = 400;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PROJECT_URL = 'https://github.com/Cartograf666/concert-for-travelers-api';

export interface GeocodeCacheEntry {
  lat: number | null;
  lng: number | null;
  /** Present for a resolved or confirmed-empty Nominatim response. */
  geocodedAt?: string;
  cityEn?: string | null;
  /** A transport/provider failure: retry on a future bounded pass. */
  retryable?: boolean;
  lastAttemptAt?: string;
}
export type GeocodeCache = Record<string, GeocodeCacheEntry>;

function isCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Reject corrupt cache files instead of silently replacing a recoverable cache
 * with an empty one on the next checkpoint. */
export function assertGeocodeCache(value: unknown): asserts value is GeocodeCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('geocode cache must be an object');
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`invalid geocode cache entry: ${key}`);
    const e = entry as Partial<GeocodeCacheEntry>;
    const validStamp = (stamp: unknown) => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp));
    if ((e.lat !== null && !isCoordinate(e.lat, -90, 90)) || (e.lng !== null && !isCoordinate(e.lng, -180, 180)) ||
        (e.lat === null) !== (e.lng === null) ||
        (e.geocodedAt !== undefined && !validStamp(e.geocodedAt)) ||
        (e.lastAttemptAt !== undefined && !validStamp(e.lastAttemptAt)) ||
        (e.retryable !== undefined && typeof e.retryable !== 'boolean') ||
        (e.cityEn !== undefined && e.cityEn !== null && typeof e.cityEn !== 'string') ||
        (!e.retryable && e.geocodedAt === undefined)) {
      throw new Error(`invalid geocode cache entry: ${key}`);
    }
  }
}

export async function loadGeocodeCache(cachePath: string): Promise<GeocodeCache> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`invalid geocode cache JSON: ${cachePath}`); }
  assertGeocodeCache(parsed);
  return parsed;
}

function timestamp(entry: GeocodeCacheEntry): number {
  return entry.geocodedAt ? Date.parse(entry.geocodedAt) : Number.NEGATIVE_INFINITY;
}

/** Merge the primary and retained backup without re-keying strings (including
 * non-Latin venue names). The newer confirmed response wins, but a later
 * retryable failure can never erase usable coordinates from the other copy. */
export function mergeGeocodeCaches(primary: GeocodeCache, backup: GeocodeCache): GeocodeCache {
  const merged: GeocodeCache = {};
  for (const key of new Set([...Object.keys(backup), ...Object.keys(primary)])) {
    const first = primary[key];
    const second = backup[key];
    if (!first) { merged[key] = { ...second! }; continue; }
    if (!second) { merged[key] = { ...first }; continue; }
    const winner = timestamp(first) >= timestamp(second) ? first : second;
    const loser = winner === first ? second : first;
    const winnerHasCoords = winner.lat !== null && winner.lng !== null;
    const loserHasCoords = loser.lat !== null && loser.lng !== null;
    const latestAttempt = [first, second].filter((entry) => entry.lastAttemptAt).sort((a, b) => a.lastAttemptAt!.localeCompare(b.lastAttemptAt!)).at(-1);
    merged[key] = {
      ...winner,
      lat: winnerHasCoords ? winner.lat : (loserHasCoords ? loser.lat : null),
      lng: winnerHasCoords ? winner.lng : (loserHasCoords ? loser.lng : null),
      cityEn: winner.cityEn === undefined ? loser.cityEn : winner.cityEn,
      // A newer successful/terminal response clears a stale retry marker; a
      // later transport failure remains eligible even if backup has coordinates.
      retryable: latestAttempt?.retryable && Date.parse(latestAttempt.lastAttemptAt!) >= timestamp(winner) ? true : undefined,
      lastAttemptAt: latestAttempt?.lastAttemptAt
    };
  }
  return merged;
}

/** Strictly validate both sources before merging: a corrupt primary must never
 * be silently overwritten by a backup recovery pass. */
export async function loadGeocodeCacheWithBackup(primaryPath: string, backupPath: string): Promise<GeocodeCache> {
  const [primary, backup] = await Promise.all([loadGeocodeCache(primaryPath), loadGeocodeCache(backupPath)]);
  return mergeGeocodeCaches(primary, backup);
}

/** Atomically checkpoint cache updates and create its parent directory for a
 * first backfill run. */
export async function saveGeocodeCache(cachePath: string, cache: GeocodeCache): Promise<void> {
  assertGeocodeCache(cache);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
  await fs.rename(temporary, cachePath);
}

export function geocodeCacheKey(concert: Pick<Concert, 'venue' | 'city' | 'country'>): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(concert.venue)}|${norm(concert.city)}|${norm(concert.country)}`;
}

export type GeocodeFn = (query: string) => Promise<{ lat: number; lng: number; cityEn?: string | null } | null>;

/** A direct, policy-compliant Nominatim transport. Kept lazy: callers running
 * cache-only never construct or invoke a provider client. */
export function createNominatimGeocodeFn(): GeocodeFn {
  const email = process.env.NOMINATIM_EMAIL;
  const userAgent = `ConcertForTravelers/1.0 (+${PROJECT_URL}${email ? `; ${email}` : ''})`;
  return async (query: string) => {
    const response = await axios.get(NOMINATIM_URL, {
      params: { q: query, format: 'jsonv2', addressdetails: 1, 'accept-language': 'en', ...(email ? { email } : {}) },
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      timeout: NOMINATIM_TIMEOUT_MS
    });
    return parseNominatimResponse(response.data);
  };
}

/** Empty search results are a durable miss. A malformed provider response is a
 * transient failure, never a cache entry that suppresses later retries. */
export function parseNominatimResponse(data: unknown): Awaited<ReturnType<GeocodeFn>> {
  if (!Array.isArray(data)) throw new Error('invalid Nominatim response: expected an array');
  if (data.length === 0) return null;
  const result = data[0];
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid Nominatim response: invalid result');
  const record = result as Record<string, unknown>;
  if (typeof record.lat !== 'number' && (typeof record.lat !== 'string' || record.lat.trim() === '') ||
      typeof record.lon !== 'number' && (typeof record.lon !== 'string' || record.lon.trim() === '')) {
    throw new Error('invalid Nominatim response: missing coordinates');
  }
  const lat = Number(record.lat);
  const lng = Number(record.lon);
  if (!isCoordinate(lat, -90, 90) || !isCoordinate(lng, -180, 180)) throw new Error('invalid Nominatim response: invalid coordinates');
  const address = record.address;
  if (address !== undefined && (!address || typeof address !== 'object' || Array.isArray(address))) throw new Error('invalid Nominatim response: invalid address');
  const locality = (address ?? {}) as Record<string, unknown>;
  const cityEn = locality.city ?? locality.town ?? locality.village ?? locality.state ?? null;
  return { lat, lng, cityEn: typeof cityEn === 'string' ? cityEn : null };
}

export interface GeocodeConcertsOptions {
  cache?: GeocodeCache;
  maxPerRun?: number;
  geocodeFn?: GeocodeFn;
  delayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Called after every fresh attempt so a bulk caller can checkpoint progress. */
  onAttempt?: () => Promise<void> | void;
}
export interface GeocodeStats {
  attempted: number;
  filledFromCache: number;
  geocoded: number;
  failed: number;
  skippedCapped: number;
  cityTranslated: number;
}

/** Mutates concerts and cache in place. With maxPerRun: 0 this is a pure cache
 * reader; no transport is initialized and no provider request occurs. */
export async function geocodeConcerts(concerts: Concert[], options: GeocodeConcertsOptions = {}): Promise<GeocodeStats> {
  const cache = options.cache ?? {};
  const maxPerRun = Math.max(0, options.maxPerRun ?? DEFAULT_MAX_PER_RUN);
  const delayMs = options.delayMs ?? NOMINATIM_RATE_LIMIT_MS;
  const wait = options.sleepFn ?? sleep;
  let geocodeFn = options.geocodeFn;
  const attemptedKeys = new Set<string>(); // includes transient failures for this run
  const stats: GeocodeStats = { attempted: 0, filledFromCache: 0, geocoded: 0, failed: 0, skippedCapped: 0, cityTranslated: 0 };

  const queue = concerts.map((concert, index) => ({ concert, index })).sort((a, b) => {
    const aStamp = cache[geocodeCacheKey(a.concert)]?.lastAttemptAt ?? '';
    const bStamp = cache[geocodeCacheKey(b.concert)]?.lastAttemptAt ?? '';
    return aStamp.localeCompare(bStamp) || a.index - b.index;
  });
  for (const { concert } of queue) {
    if (!concert.venue || !concert.city || !concert.country) continue;
    const key = geocodeCacheKey(concert);
    const cached = cache[key];
    const needsCoords = concert.lat === undefined || concert.lng === undefined;
    // Key is deliberately computed before this mutation, so translated cities
    // continue to hit the original venue/city/country cache record on later runs.
    if (cached) applyEnglishCity(concert, cached.cityEn, stats);
    const needsCityEn = hasUnreadableScript(concert.city) && cached?.cityEn === undefined;
    let usedCachedCoords = false;
    if (!needsCoords && !needsCityEn && !cached?.retryable) continue;

    // Apply legacy cache coordinates even if we still need the one-time English
    // city lookup. Never replace source-supplied coordinates with Nominatim's.
    if (cached) {
      if (needsCoords && cached.lat !== null && cached.lng !== null) {
        if (concert.lat === undefined) concert.lat = cached.lat;
        if (concert.lng === undefined) concert.lng = cached.lng;
        usedCachedCoords = true;
        stats.filledFromCache++;
      } else if (!needsCityEn) {
        stats.filledFromCache++;
      }
      if (!needsCityEn && !cached.retryable) continue;
    }

    if (attemptedKeys.has(key)) continue;
    // Mark capped keys too: duplicate concerts must not inflate either requests
    // or deferred counts during one run.
    if (stats.attempted >= maxPerRun) { attemptedKeys.add(key); stats.skippedCapped++; continue; }
    attemptedKeys.add(key);
    stats.attempted++;
    const query = `${concert.venue}, ${concert.city}, ${concert.country}`;
    try {
      geocodeFn ??= createNominatimGeocodeFn();
      const result = await geocodeFn(query);
      const geocodedAt = (options.now ?? (() => new Date()))().toISOString();
      if (result) {
        // Lookup may be solely for city translation; retain authoritative source
        // coordinates in that case while caching Nominatim for coordinate-less rows.
        if (needsCoords && !usedCachedCoords) {
          // A source that provided either coordinate is still more authoritative
          // than a name lookup; fill only its absent counterpart.
          if (concert.lat === undefined) concert.lat = result.lat;
          if (concert.lng === undefined) concert.lng = result.lng;
        }
        cache[key] = { lat: result.lat, lng: result.lng, geocodedAt, cityEn: result.cityEn ?? null, lastAttemptAt: geocodedAt };
        applyEnglishCity(concert, result.cityEn ?? null, stats);
        stats.geocoded++;
      } else {
        // A city-only retry against a legacy coordinate cache must not destroy
        // otherwise useful coordinates merely because translation had no answer.
        cache[key] = { lat: cached?.lat ?? null, lng: cached?.lng ?? null, geocodedAt, cityEn: null, lastAttemptAt: geocodedAt };
        stats.failed++;
      }
    } catch (err: any) {
      console.warn(`[Geocode] "${query}" failed: ${err.message}`);
      const attemptedAt = (options.now ?? (() => new Date()))().toISOString();
      cache[key] = {
        lat: cached?.lat ?? null,
        lng: cached?.lng ?? null,
        ...(cached?.geocodedAt ? { geocodedAt: cached.geocodedAt } : {}),
        ...(cached?.cityEn !== undefined ? { cityEn: cached.cityEn } : {}),
        retryable: true,
        lastAttemptAt: attemptedAt
      };
      stats.failed++;
    }
    await options.onAttempt?.();
    if (stats.attempted < maxPerRun) await wait(delayMs);
  }
  return stats;
}

function applyEnglishCity(concert: Concert, cityEn: string | null | undefined, stats: GeocodeStats): void {
  if (!cityEn || !hasUnreadableScript(concert.city) || !isReadableScript(cityEn)) return;
  concert.city = cityEn;
  stats.cityTranslated++;
}
