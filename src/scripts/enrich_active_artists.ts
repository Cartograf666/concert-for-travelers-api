import * as fs from 'fs/promises';
import * as path from 'path';
import { getGeminiKeys } from '../engine/gemini_keys.js';
import { enrichMissingArtistMetadata } from '../pipeline/enrich.js';
import { PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

interface ConcertSnapshotRow {
  artist?: unknown;
  date?: unknown;
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** A normalized concert is active when its date is today or in the future; malformed dates never become targets. */
export function isActiveConcertDate(date: unknown, now = new Date()): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  // Date normalizes values such as 2026-02-31, so round-trip validation is
  // necessary before treating a snapshot row as a real upcoming concert.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date >= utcDateKey(now);
}

/**
 * Extracts the distinct artists that are still present in the published feed.
 * The feed is untrusted input from a prior scrape, so malformed rows are simply
 * ignored rather than making a background enrichment job fail.
 */
export function selectActiveArtistNames(snapshot: unknown, now = new Date()): string[] {
  if (!Array.isArray(snapshot)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of snapshot as ConcertSnapshotRow[]) {
    if (!isActiveConcertDate(row?.date, now) || typeof row?.artist !== 'string') continue;
    const name = row.artist.trim();
    const key = name.toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export async function loadActiveArtistNames(snapshotPath: string, now = new Date()): Promise<string[]> {
  try {
    return selectActiveArtistNames(JSON.parse(await fs.readFile(snapshotPath, 'utf-8')), now);
  } catch (error: any) {
    console.warn(`[ActiveEnrichment] Could not read published concert snapshot at ${snapshotPath}: ${error.message}`);
    return [];
  }
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`limit must be a positive integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const snapshotPath = args[0] ?? path.join(process.cwd(), 'reports', 'last-good-site', 'concerts.json');
  const limit = parseLimit(args[1]);
  const activeArtists = await loadActiveArtistNames(snapshotPath);
  const targets = limit === undefined ? activeArtists : activeArtists.slice(0, limit);

  if (targets.length === 0) {
    console.log('[ActiveEnrichment] No active artists found in the last-good published snapshot. Nothing to enrich.');
    return;
  }

  const keys = getGeminiKeys();
  if (keys.length === 0) {
    console.warn('[ActiveEnrichment] No Gemini keys configured. Leaving active artists eligible for a later run.');
    return;
  }

  console.log(`[ActiveEnrichment] Enriching metadata for up to ${targets.length}/${activeArtists.length} active artists from ${snapshotPath}.`);
  await enrichMissingArtistMetadata(targets, PRODUCTION_ARTIST_DB_DIR, keys);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`[ActiveEnrichment] ${error.message}`);
    process.exit(1);
  });
}
