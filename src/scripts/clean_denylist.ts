import * as fs from 'fs/promises';
import * as path from 'path';

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
 * Idempotent: safe to re-run.
 */
async function main() {
  const root = process.cwd();
  const approvedPath = path.join(root, 'data', 'approved_artists.json');
  const denylistPath = path.join(root, 'data', 'artist_denylist.json');
  const targetsPath = path.join(root, 'data', 'artist_scrape_targets.txt');

  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  const approved: any[] = JSON.parse(await fs.readFile(approvedPath, 'utf-8'));
  const denyTerms: string[] = JSON.parse(await fs.readFile(denylistPath, 'utf-8')).terms;
  const deny = new Set(denyTerms.map(norm));

  let targets = new Set<string>();
  try {
    const raw = await fs.readFile(targetsPath, 'utf-8');
    targets = new Set(raw.split('\n').map(norm).filter(Boolean));
  } catch { /* no target list -> guard just doesn't apply */ }

  const removed: string[] = [];
  const kept = approved.filter((a) => {
    const name = typeof a === 'string' ? a : a.name;
    const key = norm(name);
    if (deny.has(key) && !targets.has(key)) {
      removed.push(name);
      return false;
    }
    return true;
  });

  if (removed.length === 0) {
    console.log('[CleanDenylist] No denylisted non-artist entries present. Nothing to remove.');
    return;
  }

  await fs.writeFile(approvedPath, JSON.stringify(kept, null, 2), 'utf-8');
  console.log(`[CleanDenylist] Removed ${removed.length} non-artist entries (now ${kept.length}).`);
  console.log(`[CleanDenylist] Removed: ${removed.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
