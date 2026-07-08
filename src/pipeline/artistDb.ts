import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Centralizes every read/write of the approved-artist whitelist so the ~10
 * independent scripts that touch it don't each reimplement (and potentially
 * diverge on) load/save/sort/atomic-rename logic, and so storage can be
 * SHARDED transparently -- callers just get/pass a plain array, unaware of
 * how it's actually laid out on disk.
 *
 * Why shard: this file previously was one ~17MB JSON blob that ~6 independent
 * cron-scheduled scripts each read+rewrote WHOLESALE. Two of them writing
 * around the same time could hit an unresolvable git rebase conflict and
 * drop one's work entirely (see data/conflict-drops.json / status.json's
 * conflictDropsLast7Days, added to make this visible). Sharded by the
 * artist name's first character (mod SHARD_COUNT) into
 * data/artists/shard-N.json: two writers touching artists in DIFFERENT
 * shards now have zero file overlap -- not just "less likely to conflict",
 * literally impossible to. A shard whose content is byte-identical to what's
 * already on disk (same deterministic sort+stringify) is never rewritten, so
 * a writer that only actually changed a few entries doesn't touch every
 * other shard's mtime/git-diff either.
 *
 * Legacy single-file mode: a `location` ending in `.json` is treated as one
 * plain file (used by the test suite's isolated temp files, and the one-off
 * download_artists.ts bootstrap) -- unchanged behavior from before sharding
 * existed. A `location` WITHOUT a `.json` suffix is treated as the sharded
 * directory. This lets every call site just point at "the DB" without
 * knowing which mode it's in.
 */

const SHARD_COUNT = 8;

/** Production storage location -- a directory, not a single file. */
export const PRODUCTION_ARTIST_DB_DIR = path.join(process.cwd(), 'data', 'artists');

function isLegacyFileLocation(location: string): boolean {
  return location.toLowerCase().endsWith('.json');
}

function entryName(a: any): string {
  return typeof a === 'string' ? a : (a?.name ?? '');
}

function shardIndexForName(name: string): number {
  const ch = name.trim().charAt(0).toUpperCase();
  const code = ch.charCodeAt(0) || 0;
  return code % SHARD_COUNT;
}

function shardFilePath(dir: string, i: number): string {
  return path.join(dir, `shard-${i}.json`);
}

function sortByName(artists: any[]): any[] {
  return [...artists].sort((a, b) => entryName(a).localeCompare(entryName(b)));
}

/**
 * Loads the whole whitelist as one flat array, regardless of storage mode.
 *
 * Only a genuinely missing file/directory (ENOENT -- the legitimate "nothing
 * written yet" bootstrap case) resolves to an empty array. Any other error
 * (corrupt JSON, permission denied, ...) is rethrown rather than swallowed --
 * every call site here used to `JSON.parse(readFileSync(...))` directly and
 * let that throw propagate (usually a fatal exit), and silently treating a
 * real read failure as "empty DB" would risk a subsequent save wiping out
 * the on-disk data instead of surfacing the problem.
 */
export async function loadApprovedArtists(location: string): Promise<any[]> {
  if (isLegacyFileLocation(location)) {
    try {
      return JSON.parse(await fs.readFile(location, 'utf-8'));
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  let files: string[];
  try {
    files = (await fs.readdir(location)).filter((f) => /^shard-\d+\.json$/.test(f));
  } catch (err: any) {
    if (err.code === 'ENOENT') return []; // directory doesn't exist yet -> empty DB
    throw err;
  }

  const all: any[] = [];
  for (const f of files.sort()) {
    all.push(...JSON.parse(await fs.readFile(path.join(location, f), 'utf-8')));
  }
  return all;
}

/**
 * Saves the whole whitelist. Sharded mode only rewrites a shard whose content
 * actually changed (byte-for-byte against what's on disk); legacy mode is a
 * plain atomic tmp+rename write of the one file.
 */
export async function saveApprovedArtists(location: string, artists: any[]): Promise<void> {
  if (isLegacyFileLocation(location)) {
    const sorted = sortByName(artists);
    const tmp = location + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(sorted, null, 2), 'utf-8');
    await fs.rename(tmp, location);
    return;
  }

  const shards: any[][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const a of artists) {
    shards[shardIndexForName(entryName(a))].push(a);
  }

  await fs.mkdir(location, { recursive: true });
  for (let i = 0; i < SHARD_COUNT; i++) {
    const content = JSON.stringify(sortByName(shards[i]), null, 2);
    let existing: string | null = null;
    try {
      existing = await fs.readFile(shardFilePath(location, i), 'utf-8');
    } catch {
      // Shard file doesn't exist yet -> definitely write it.
    }
    if (existing === content) continue; // unchanged -> don't touch the file at all

    const tmp = shardFilePath(location, i) + '.tmp';
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, shardFilePath(location, i));
  }
}
