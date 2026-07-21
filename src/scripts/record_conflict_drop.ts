import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Appends one conflict-drop event to data/conflict-drops.json, trimmed to the
 * last 30 days. A "conflict drop" is a workflow's git-push retry loop hitting
 * an unresolvable rebase conflict on data/artists/ (the sharded artist DB) and
 * giving up on that run/sub-chunk's commit (see enrich-auto.yml,
 * enrich-database.yml, enrich-metadata.yml, enrich-similar.yml,
 * data-hygiene.yml, daily-scrape.yml). Previously this was only a
 * `::warning::` annotation inside that one run's log -- easy to miss, no
 * visibility over time. This makes it queryable and lets dist/status.json
 * surface a rolling count.
 *
 * Note: since reapply_artist_db_delta.ts landed, most conflicts on
 * data/artists/ get resolved by replaying the sub-chunk's own delta onto a
 * fresh origin/main instead of dropping the whole commit -- this metric now
 * only fires when that replay-and-repush itself still fails (or, in
 * enrich-database.yml's case, on the separate scrapers/ directory that isn't
 * covered by the replay). It undercounts relative to its original "every
 * unresolvable conflict" meaning; read conflictDropsLast7Days with that
 * narrower definition in mind.
 *
 * Usage: record_conflict_drop.ts <workflow-name>
 * Best-effort by design: called with `|| true` from the workflows above, so a
 * failure here (e.g. this tiny commit itself racing another writer) never
 * fails the calling job -- losing an occasional metric event is fine.
 */
async function main() {
  const workflow = process.argv[2] || 'unknown';
  const filePath = path.join(process.cwd(), 'data', 'conflict-drops.json');

  let data: { events: Array<{ workflow: string; at: string }> } = { events: [] };
  try {
    data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    // Missing/unreadable -> start fresh.
  }

  data.events.push({ workflow, at: new Date().toISOString() });

  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  data.events = data.events.filter((e) => new Date(e.at).getTime() > cutoffMs);

  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`[ConflictDrop] Recorded a drop for "${workflow}" (${data.events.length} event(s) in the last 30 days).`);
}

main().catch((err) => {
  console.error(`[ConflictDrop] Fatal: ${err.message}`);
  process.exit(1);
});
