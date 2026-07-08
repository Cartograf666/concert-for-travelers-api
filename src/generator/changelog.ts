import * as fs from 'fs/promises';
import * as path from 'path';
import { Concert } from '../schemas/concert.js';
import { slugify } from '../pipeline/process.js';

/**
 * Publishes dist/changes.json: concerts that are new since the LAST run, so
 * the consumer app can show "N new concerts since your last visit" without
 * diffing the full concerts.json itself.
 *
 * Identity for "is this the same concert as before" reuses processConcerts'
 * own dedupe key (artist+date+city) -- the same notion of "one concert"
 * already used everywhere else in the pipeline, not a second definition.
 *
 * State (which concerts were already known) is NOT git-tracked -- persisted
 * via the same actions/cache mechanism reports/scrape-cache.json already
 * uses, so it survives across daily runs without adding another writer to
 * data/approved_artists.json's contention.
 */

export function concertKey(c: Pick<Concert, 'artist' | 'date' | 'city'>): string {
  return `${slugify(c.artist)}_${c.date}_${slugify(c.city)}`;
}

export interface ChangelogCache {
  knownKeys: string[];
}

export interface ChangeEntry {
  concertId: string;
  artist: string;
  date: string;
  venue: string;
  city: string;
  country: string;
  detectedAt: string;
}

export async function loadChangelogCache(cachePath: string): Promise<ChangelogCache> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  } catch {
    return { knownKeys: [] };
  }
}

export async function saveChangelogCache(cachePath: string, cache: ChangelogCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache), 'utf-8');
}

const CHANGES_RETENTION_DAYS = 30;

export interface PublishChangelogResult {
  newCount: number;
  coldStart: boolean; // first-ever run (no prior cache) -- nothing reported as "new" to avoid a false burst
}

/**
 * Diffs `concerts` against `cache` (the last run's known concert keys),
 * writes any genuinely new ones into outputDir/changes.json (merged with
 * whatever's still within the retention window from previous runs), and
 * updates `cache` in place with the full current key set for next time.
 *
 * Cold start (cache has never been populated) reports zero changes -- the
 * first run ever would otherwise see every single concert as "new", which is
 * noise, not a changelog.
 */
export async function publishChangelog(
  concerts: Concert[],
  outputDir: string,
  cache: ChangelogCache
): Promise<PublishChangelogResult> {
  const coldStart = cache.knownKeys.length === 0;
  const known = new Set(cache.knownKeys);
  const detectedAt = new Date().toISOString();

  const newConcerts = coldStart ? [] : concerts.filter((c) => !known.has(concertKey(c)));

  const changesPath = path.join(outputDir, 'changes.json');
  let existing: ChangeEntry[] = [];
  try {
    existing = JSON.parse(await fs.readFile(changesPath, 'utf-8'));
  } catch {
    // No prior changes.json (or a fresh dist/) -- start empty.
  }

  const additions: ChangeEntry[] = newConcerts.map((c) => ({
    concertId: concertKey(c),
    artist: c.artist,
    date: c.date,
    venue: c.venue,
    city: c.city,
    country: c.country,
    detectedAt
  }));

  const cutoffMs = Date.now() - CHANGES_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const merged = [...existing.filter((e) => new Date(e.detectedAt).getTime() > cutoffMs), ...additions];

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(changesPath, JSON.stringify(merged), 'utf-8');

  // Update the cache in place with EVERY current key (not just the new ones)
  // so next run's diff is against the full known set.
  cache.knownKeys = concerts.map(concertKey);

  return { newCount: additions.length, coldStart };
}
