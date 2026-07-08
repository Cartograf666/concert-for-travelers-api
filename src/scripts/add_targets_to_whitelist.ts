import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

/**
 * Ensures every artist in data/artist_scrape_targets.txt exists in
 * the approved-artist whitelist (data/artists/). Without this, the Bandsintown/tour-page sweeps fetch
 * concerts for a user's favorite artist but processConcerts drops them (not on the
 * approved whitelist) -- silently losing exactly the artists the target list exists
 * to cover. Idempotent: only adds what's missing, so it's safe to re-run (e.g. after
 * a rebase, or once the target list grows).
 */
async function main() {
  const root = process.cwd();
  const targetsPath = path.join(root, 'data', 'artist_scrape_targets.txt');

  const approved: any[] = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const present = new Set(approved.map((a) => norm(typeof a === 'string' ? a : a.name)));

  const rawTargets = (await fs.readFile(targetsPath, 'utf-8')).split('\n');
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const line of rawTargets) {
    const name = line.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(name);
  }

  const toAdd = targets.filter((t) => !present.has(norm(t)));
  if (toAdd.length === 0) {
    console.log('[AddTargets] All targets already in the whitelist. Nothing to add.');
    return;
  }

  for (const name of toAdd) {
    approved.push({ name, website: null });
  }

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, approved);
  console.log(`[AddTargets] Added ${toAdd.length} target artists to the whitelist (now ${approved.length} entries).`);
  console.log(`[AddTargets] Sample: ${toAdd.slice(0, 10).join(', ')}${toAdd.length > 10 ? ' ...' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
