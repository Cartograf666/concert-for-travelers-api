import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { stableJson } from './diffUtil.js';

function keyFor(entry: any): string {
  return typeof entry === 'string' ? entry : String(entry?.name ?? '');
}

export interface ReapplyStats {
  changedOrAdded: number;
  removed: number;
  skippedConflicts: number;
  finalCount: number;
}

/**
 * Replays artist DB changes from a before/after snapshot onto the current DB.
 * Used by GitHub Actions after an unresolvable rebase conflict: reset to fresh
 * origin/main, then replay only the rows this sub-chunk actually changed.
 */
export async function reapplyArtistDbDelta(beforeDir: string, afterDir: string, currentDir = PRODUCTION_ARTIST_DB_DIR): Promise<ReapplyStats> {
  const [beforeRows, afterRows, currentRows] = await Promise.all([
    loadApprovedArtists(beforeDir),
    loadApprovedArtists(afterDir),
    loadApprovedArtists(currentDir)
  ]);

  const before = new Map(beforeRows.map((row) => [keyFor(row), row]));
  const after = new Map(afterRows.map((row) => [keyFor(row), row]));
  const current = new Map(currentRows.map((row) => [keyFor(row), row]));

  let changedOrAdded = 0;
  let skippedConflicts = 0;
  for (const [key, afterRow] of after) {
    if (!key) continue;
    const beforeRow = before.get(key);
    if (!beforeRow || stableJson(beforeRow) !== stableJson(afterRow)) {
      const currentRow = current.get(key);
      if (currentRow && stableJson(currentRow) !== stableJson(beforeRow) && stableJson(currentRow) !== stableJson(afterRow)) {
        skippedConflicts++;
        continue;
      }
      current.set(key, afterRow);
      changedOrAdded++;
    }
  }

  let removed = 0;
  for (const key of before.keys()) {
    if (!key || after.has(key)) continue;
    const beforeRow = before.get(key);
    const currentRow = current.get(key);
    if (!currentRow) continue;
    if (stableJson(currentRow) !== stableJson(beforeRow)) {
      skippedConflicts++;
      continue;
    }
    current.delete(key);
    removed++;
  }

  const merged = Array.from(current.values());
  await saveApprovedArtists(currentDir, merged);
  return { changedOrAdded, removed, skippedConflicts, finalCount: merged.length };
}

async function main() {
  const [beforeDir, afterDir, currentDir] = process.argv.slice(2);
  if (!beforeDir || !afterDir) {
    console.error('Usage: reapply_artist_db_delta.ts <beforeDir> <afterDir> [currentDir]');
    process.exitCode = 1;
    return;
  }
  const stats = await reapplyArtistDbDelta(beforeDir, afterDir, currentDir);
  if (stats.skippedConflicts > 0) {
    console.warn(`[ReapplyArtistDbDelta] skippedConflicts=${stats.skippedConflicts}; at least one row changed concurrently and was not overwritten.`);
  }
  console.log(`[ReapplyArtistDbDelta] changedOrAdded=${stats.changedOrAdded}, removed=${stats.removed}, skippedConflicts=${stats.skippedConflicts}, finalCount=${stats.finalCount}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ReapplyArtistDbDelta] Fatal: ${err.message}`);
    process.exit(1);
  });
}
