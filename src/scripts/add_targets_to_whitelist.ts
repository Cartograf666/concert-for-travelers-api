import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Ensures every artist in data/artist_scrape_targets.txt exists in
 * data/approved_artists.json. Without this, the Bandsintown/tour-page sweeps fetch
 * concerts for a user's favorite artist but processConcerts drops them (not on the
 * approved whitelist) -- silently losing exactly the artists the target list exists
 * to cover. Idempotent: only adds what's missing, so it's safe to re-run (e.g. after
 * a rebase, or once the target list grows).
 */
async function main() {
  const root = process.cwd();
  const approvedPath = path.join(root, 'data', 'approved_artists.json');
  const targetsPath = path.join(root, 'data', 'artist_scrape_targets.txt');

  const approved: any[] = JSON.parse(await fs.readFile(approvedPath, 'utf-8'));
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
  approved.sort((a, b) => {
    const an = typeof a === 'string' ? a : a.name;
    const bn = typeof b === 'string' ? b : b.name;
    return an.localeCompare(bn);
  });

  await fs.writeFile(approvedPath, JSON.stringify(approved, null, 2), 'utf-8');
  console.log(`[AddTargets] Added ${toAdd.length} target artists to the whitelist (now ${approved.length} entries).`);
  console.log(`[AddTargets] Sample: ${toAdd.slice(0, 10).join(', ')}${toAdd.length > 10 ? ' ...' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
