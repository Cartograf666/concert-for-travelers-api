import * as fs from 'fs/promises';
import * as path from 'path';
import { ConcertSchema, type Concert } from '../schemas/concert.js';
import {
  createNominatimGeocodeFn,
  geocodeCacheKey,
  geocodeConcerts,
  loadGeocodeCacheWithBackup,
  saveGeocodeCache,
  type GeocodeCache,
  type GeocodeFn,
  type GeocodeStats,
  NOMINATIM_RATE_LIMIT_MS
} from '../pipeline/geocode.js';

export const DEFAULT_CONCERTS_PATH = path.join('reports', 'last-good-site', 'concerts.json');
export const DEFAULT_CACHE_PATH = path.join('reports', 'geocode-cache.json');
export const DEFAULT_BACKUP_CACHE_PATH = path.join('reports', 'geocode-cache-backup.json');
export const DEFAULT_LOOKUP_CAP = 100;

export interface GeocodeBackfillOptions {
  concertsPath?: string;
  cachePath?: string;
  backupPath?: string;
  maxLookups?: number;
  geocodeFn?: GeocodeFn;
  delayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface GeocodeBackfillResult {
  stats: GeocodeStats;
  unresolvedUniqueVenues: number;
  oldestCacheAgeDays: number | null;
}

export function parseBackfillArgs(args: string[]): Required<Pick<GeocodeBackfillOptions, 'concertsPath' | 'cachePath' | 'maxLookups'>> {
  const [concertsPath = DEFAULT_CONCERTS_PATH, cachePath = DEFAULT_CACHE_PATH, cap = String(DEFAULT_LOOKUP_CAP)] = args;
  if (args.length > 3) throw new Error('usage: geocode_backfill.ts [concertsPath] [cachePath] [maxLookups]');
  const maxLookups = Number(cap);
  if (!Number.isInteger(maxLookups) || maxLookups < 0) throw new Error('maxLookups must be a non-negative integer');
  return { concertsPath, cachePath, maxLookups };
}

async function loadConcerts(concertsPath: string): Promise<Concert[]> {
  let raw: unknown;
  try { raw = JSON.parse(await fs.readFile(concertsPath, 'utf-8')); }
  catch (err: any) { throw new Error(`invalid concerts JSON (${concertsPath}): ${err.message}`); }
  const parsed = ConcertSchema.array().safeParse(raw);
  if (!parsed.success) throw new Error(`invalid concerts input (${concertsPath}): ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`);
  return parsed.data;
}

function unresolvedVenueCount(concerts: Concert[]): number {
  return new Set(concerts.filter((c) => c.lat === undefined || c.lng === undefined).map(geocodeCacheKey)).size;
}

function oldestCacheAgeDays(cache: GeocodeCache): number | null {
  const times = Object.values(cache).flatMap((entry) => entry.geocodedAt ? [Date.parse(entry.geocodedAt)] : []).filter(Number.isFinite);
  if (times.length === 0) return null;
  return Math.floor((Date.now() - Math.min(...times)) / 86_400_000);
}

/** Runs a bounded, sequential Nominatim pass. The cache is saved atomically
 * after every attempted lookup, so a crash or a later provider error retains
 * all completed work. */
export async function runGeocodeBackfill(options: GeocodeBackfillOptions = {}): Promise<GeocodeBackfillResult> {
  const concertsPath = options.concertsPath ?? DEFAULT_CONCERTS_PATH;
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const backupPath = options.backupPath ?? DEFAULT_BACKUP_CACHE_PATH;
  const maxLookups = options.maxLookups ?? DEFAULT_LOOKUP_CAP;
  if (!Number.isInteger(maxLookups) || maxLookups < 0) throw new Error('maxLookups must be a non-negative integer');
  const concerts = await loadConcerts(concertsPath);
  const cache = await loadGeocodeCacheWithBackup(cachePath, backupPath);
  const stats = await geocodeConcerts(concerts, {
    cache,
    maxPerRun: maxLookups,
    geocodeFn: options.geocodeFn ?? createNominatimGeocodeFn(),
    delayMs: options.delayMs ?? NOMINATIM_RATE_LIMIT_MS,
    sleepFn: options.sleepFn,
    onAttempt: () => saveGeocodeCache(cachePath, cache)
  });
  // Creates an empty initial cache too, making the chosen checkpoint location
  // visible before the next scheduled run.
  if (stats.attempted === 0) await saveGeocodeCache(cachePath, cache);
  return { stats, unresolvedUniqueVenues: unresolvedVenueCount(concerts), oldestCacheAgeDays: oldestCacheAgeDays(cache) };
}

async function main(): Promise<void> {
  const options = parseBackfillArgs(process.argv.slice(2));
  const result = await runGeocodeBackfill(options);
  const { stats } = result;
  console.log(`[geocode-backfill] attempted ${stats.attempted}, resolved ${stats.geocoded}, cache hits ${stats.filledFromCache}, failed ${stats.failed}, deferred ${stats.skippedCapped}`);
  console.log(`[geocode-backfill] unresolved unique venues: ${result.unresolvedUniqueVenues}; oldest cache entry: ${result.oldestCacheAgeDays === null ? 'n/a' : `${result.oldestCacheAgeDays}d`}`);
}

if (require.main === module) {
  main().catch((err: any) => { console.error(`[geocode-backfill] fatal: ${err.message}`); process.exitCode = 1; });
}
