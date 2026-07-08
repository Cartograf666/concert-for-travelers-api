import * as fs from 'fs/promises';
import * as path from 'path';
import { loadCache } from '../engine/cache.js';
import { buildApprovedMatcher, cleanArtistName } from '../pipeline/process.js';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';

// Below this many characters the "artist" is almost certainly a full event title
// or sentence, not a name -- deprioritized in the report, not hidden, since it's
// still occasionally a real (if verbose) act name.
const PLAUSIBLE_NAME_MAX_LEN = 40;

interface GapEntry {
  rawName: string;
  count: number;
  sources: string[];
  plausibleName: boolean;
}

/**
 * Reruns the approved-artist match against the raw per-venue scrape cache and
 * reports every rejected raw artist name, ranked by how many distinct scrapers
 * produced it. A name seen across multiple venues is a much stronger signal of a
 * real touring artist missing from the approved-artist whitelist (data/artists/) than
 * a one-off -- most one-off rejections are non-artist content (club nights, festivals,
 * dance classes) that a venue's own listing page mixes in alongside real concerts.
 *
 * This does NOT modify the whitelist -- it only reports candidates for a human (or
 * another agent) to verify and add.
 */
async function main() {
  const cachePath = path.join(process.cwd(), 'reports', 'scrape-cache.json');
  const outPath = path.join(process.cwd(), 'reports', 'artist-gap-report.json');

  const cache = await loadCache(cachePath);
  const cacheKeys = Object.keys(cache);
  if (cacheKeys.length === 0) {
    console.error(
      `[GapAudit] No usable cache at ${cachePath}. Run "npm run scrape" first, or download ` +
      `the "scraper-reports" artifact from a recent Daily Concert Scrape workflow run into reports/.`
    );
    process.exitCode = 1;
    return;
  }

  const approvedArtists = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  const match = buildApprovedMatcher(approvedArtists);

  const gaps = new Map<string, GapEntry>();
  let totalRaw = 0;
  let totalApproved = 0;

  for (const sourceId of cacheKeys) {
    for (const raw of cache[sourceId].concerts) {
      if (!raw.artist) continue;
      totalRaw++;
      if (match(raw.artist)) {
        totalApproved++;
        continue;
      }
      const key = cleanArtistName(raw.artist);
      const existing = gaps.get(key);
      if (existing) {
        existing.count++;
        if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
      } else {
        gaps.set(key, {
          rawName: key,
          count: 1,
          sources: [sourceId],
          plausibleName: key.length <= PLAUSIBLE_NAME_MAX_LEN
        });
      }
    }
  }

  const ranked = Array.from(gaps.values()).sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return b.count - a.count;
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalRawConcerts: totalRaw,
        totalApproved,
        totalRejectedUnique: ranked.length,
        candidates: ranked
      },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`[GapAudit] ${totalRaw} raw concerts -> ${totalApproved} approved, ${ranked.length} unique rejected names.`);
  console.log(`[GapAudit] Full report written to ${outPath}.`);
  console.log(`[GapAudit] Top candidates seen across multiple venues (strongest signal of a real, missing artist):`);
  const multiVenue = ranked.filter((g) => g.sources.length > 1 && g.plausibleName);
  if (multiVenue.length === 0) {
    console.log('  (none this run)');
  } else {
    for (const g of multiVenue.slice(0, 30)) {
      console.log(`  ${g.sources.length}x venues, ${g.count}x total -- "${g.rawName}" (${g.sources.join(', ')})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
