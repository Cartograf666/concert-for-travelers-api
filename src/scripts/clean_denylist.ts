import { loadDenylistGuard } from '../pipeline/denylist.js';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

/**
 * Removes genre/language/generic non-artist entries (data/artist_denylist.json) from
 * the approved whitelist, so a source emitting e.g. "Alternative rock" or "Afrikaans"
 * as an event's artist can't exact-match a junk entry and pollute the published feed.
 *
 * Two safety guards, because a wrong removal silently drops real coverage:
 *  - never removes anything listed in data/artist_scrape_targets.txt (a user's
 *    explicit favorite always wins over the denylist -- e.g. "drum and bass");
 *  - only EXACT (normalized) matches are removed, never substrings, so a real band
 *    whose name merely contains a genre word ("Jazz Sabbath", "Rock Goddess") is safe.
 * Idempotent: safe to re-run. Same guard (src/pipeline/denylist.ts) is applied at the
 * intake side too (pipeline/enrich.ts), so a denylisted term can't be removed here and
 * then silently re-added by a later enrichment run.
 */
async function main() {
  const root = process.cwd();

  const approved: any[] = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  const guard = await loadDenylistGuard(root);

  const removed: string[] = [];
  const kept = approved.filter((a) => {
    const name = typeof a === 'string' ? a : a.name;
    if (guard.isDenylisted(name)) {
      removed.push(name);
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    console.log('[CleanDenylist] No denylisted non-artist entries present. Nothing to remove.');
    return;
  }

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, kept);
  console.log(`[CleanDenylist] Removed ${removed.length} non-artist entries (now ${kept.length}).`);
  console.log(`[CleanDenylist] Removed: ${removed.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
