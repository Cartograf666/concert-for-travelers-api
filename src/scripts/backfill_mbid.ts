import { loadDb, saveDb, queryBatch, normName, sleep, ArtistEntry, Resolved } from './enrich_wikidata_bulk.js';

export interface BackfillArtistEntry extends ArtistEntry {
  mbidBackfillTriedAt?: string;
}

/**
 * Applies one batch's SPARQL resolution to the DB rows in place, filling `mbid`
 * only for a confident (non-ambiguous) match that actually carries an mbid.
 * Extracted as its own function so this mapping -- not just the network/DB I/O
 * around it -- has direct test coverage.
 */
export function applyResolvedBatch(
  batch: BackfillArtistEntry[],
  resolved: Map<string, Resolved | 'ambiguous'>,
  stamp: string = new Date().toISOString()
): number {
  let hits = 0;
  for (const entry of batch) {
    entry.mbidBackfillTriedAt = stamp;
    const r = resolved.get(normName(entry.name));
    if (r && r !== 'ambiguous' && r.mbid) {
      entry.mbid = r.mbid;
      hits++;
    }
  }
  return hits;
}

/**
 * One-off backfill: fills `mbid` (MusicBrainz artist ID) for artists that already
 * have identity data (website/socials from a prior MusicBrainz or Wikidata-bulk
 * enrichment) but never had their MBID persisted, because that field didn't exist
 * yet at the time they were processed. Unlike enrich_wikidata_bulk.ts's normal pass
 * (gated on `!enrichedAt && !wdBulkTriedAt`, so already-enriched artists are never
 * revisited), this targets `!a.mbid` regardless of enrichment status -- reusing the
 * same batched name-lookup SPARQL query rather than duplicating it.
 *
 * Idempotent and resumable: safe to re-run, only ever fills a currently-empty mbid.
 *
 * Usage: backfill_mbid.ts [N] [batchSize]   default N=100000 (effectively "all"), batch=80
 */
async function main() {
  const n = parseInt(process.argv[2] || '100000', 10);
  const batchSize = parseInt(process.argv[3] || '80', 10);
  const artists = await loadDb() as BackfillArtistEntry[];

  const pending = artists.filter((a) => !a.mbid && !a.mbidBackfillTriedAt).slice(0, n);
  if (pending.length === 0) {
    console.log('[backfill-mbid] Nothing pending -- every artist already has an mbid or has been attempted.');
    return;
  }
  console.log(`[backfill-mbid] ${pending.length} artists missing mbid, batch ${batchSize} (${Math.ceil(pending.length / batchSize)} queries).`);

  let hits = 0;
  let processed = 0;
  const stamp = new Date().toISOString();

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let resolved: Awaited<ReturnType<typeof queryBatch>>;
    try {
      resolved = await queryBatch(batch.map((a) => a.name));
    } catch (err: any) {
      console.error(`[backfill-mbid] batch ${i / batchSize + 1} failed (${err.message}); will retry on next run.`);
      await sleep(1500);
      continue;
    }

    hits += applyResolvedBatch(batch, resolved, stamp);
    processed += batch.length;

    await saveDb(artists);
    console.log(`[backfill-mbid] ...${processed}/${pending.length} (hits ${hits})`);
    await sleep(1200); // same polite spacing as enrich_wikidata_bulk.ts
  }

  console.log('[backfill-mbid] Done.');
  console.log(`  processed : ${processed}`);
  console.log(`  hits      : ${hits}`);
  console.log(`  misses    : ${processed - hits} (no confident Wikidata match -- marked tried, still eligible for the per-artist MusicBrainz tier)`);
}

// Guard so tests can import applyResolvedBatch without triggering this file's
// own CLI run (CommonJS output -- see enrich_wikidata_bulk.ts for why
// require.main, not import.meta, is the right entrypoint check here).
if (require.main === module) {
  main().catch((err) => {
    console.error(`[backfill-mbid] Fatal: ${err.message}`);
    process.exit(1);
  });
}
