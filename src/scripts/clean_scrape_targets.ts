import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * De-duplicates data/artist_scrape_targets.txt case-insensitively. Real case
 * found live: "A Day to Remember" / "A Day To Remember" / "a day to remember"
 * all present as separate lines -- fetchBandsintownConcerts' own de-dupe
 * (src/engine/bandsintown.ts) is on the exact trimmed string, so each casing
 * variant burns its own Bandsintown fetch slot for what is the same real
 * artist, wasting a chunk of the sweep's per-run cap on redundant fetches.
 *
 * Keeps whichever casing variant has more capitalized characters -- Unicode-
 * aware (works for Cyrillic etc., not just ASCII A-Z), same intent as the
 * "probably better casing" heuristic clean_artists.ts already uses for the
 * approved-artist whitelist -- first-seen order otherwise preserved.
 * Idempotent: safe to re-run (e.g. after discover_artists.ts appends more names).
 */

/** Count of characters that differ from their own lowercase form -- true
 * capitalization in ANY script with a case distinction (Cyrillic included),
 * unlike a `/[A-Z]/` regex which only ever matches ASCII Latin letters and
 * silently counts 0 for every other script. */
function countCapitalized(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch !== ch.toLowerCase()) n++;
  }
  return n;
}

async function main() {
  const targetsPath = path.join(process.cwd(), 'data', 'artist_scrape_targets.txt');
  const raw = await fs.readFile(targetsPath, 'utf-8');
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

  const order: string[] = [];
  const bestByKey = new Map<string, string>();
  let before = 0;

  for (const line of raw.split('\n')) {
    const name = line.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    before++;
    const key = norm(name);
    const existing = bestByKey.get(key);
    if (!existing) {
      order.push(key);
      bestByKey.set(key, name);
      continue;
    }
    if (countCapitalized(name) > countCapitalized(existing)) bestByKey.set(key, name);
  }

  const deduped = order.map((k) => bestByKey.get(k)!);
  const removed = before - deduped.length;

  if (removed === 0) {
    console.log('[CleanScrapeTargets] No case-variant duplicates found. Nothing to do.');
    return;
  }

  await fs.writeFile(targetsPath, deduped.join('\n') + '\n', 'utf-8');
  console.log(`[CleanScrapeTargets] Deduplicated: ${before} -> ${deduped.length} targets (removed ${removed} case-variant duplicates).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
