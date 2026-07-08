import { loadDb as loadDbShared, saveDb as saveDbShared, normName, sleep } from './enrich_wikidata_bulk.js';
import { slugify } from '../pipeline/process.js';

/**
 * Tier-2 "similar artists" enrichment: one Last.fm `artist.getsimilar` call per
 * artist, cross-referenced against our OWN ~63k whitelist so every recommendation
 * is something the consumer app can actually link to (a suggestion pointing
 * outside this catalog is a dead end, not a feature). Deliberately a SEPARATE
 * pending-gate (similarEnrichedAt/similarTriedAt) from every other tier -- same
 * reasoning as enrich_metadata.ts: reusing enrichedAt/metaEnrichedAt would
 * permanently skip artists that already went through those tiers before this
 * one existed.
 *
 * Feeds the north-star "rank the options" flow: once a user has a few artists
 * saved, "if you like X, you might also like Y" (Y already in this catalog)
 * is a concrete discovery path this repo can serve without any new source.
 *
 * Markers:
 *   similarEnrichedAt   set when at least one Last.fm candidate resolved to a
 *                       whitelist entry.
 *   similarTriedAt      set when Last.fm was reachable but nothing resolved
 *                       (no candidates, or none are in our own whitelist) --
 *                       won't be re-queried by this tier.
 *   (network error)     entry left untouched so a later run retries it.
 *
 * Usage: enrich_similar_artists.ts [N]   process the next N pending artists (default 200)
 *
 * Resumable and idempotent. Do NOT run concurrently with another
 * approved_artists.json writer -- same single-writer-per-process convention as
 * the other enrich_*.ts scripts.
 */

export interface SimilarArtistRef {
  name: string;
  slug: string;
  match: number;
}

interface ArtistEntry {
  name: string;
  website: string | null;
  similarArtists?: SimilarArtistRef[];
  similarEnrichedAt?: string;
  similarTriedAt?: string;
  [key: string]: any; // other fields (enrichedAt, genres, ...) pass through untouched
}

const FLUSH_EVERY = 25;
// Published/stored list size -- a "you might also like" section, not a full graph dump.
const MAX_SIMILAR = 8;
// Ask Last.fm for more than we'll keep, since most of its neighbors won't be in
// our own whitelist (Last.fm's graph is much broader than 63k touring acts).
const LASTFM_RAW_LIMIT = 20;

// Thin type-adapting wrappers -- see enrich_metadata.ts for why (reuses the
// actual read/write/sort/atomic-rename logic instead of re-implementing it).
async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadDbShared()) as unknown as ArtistEntry[];
}
async function saveDb(artists: ArtistEntry[]): Promise<void> {
  return saveDbShared(artists as any);
}

interface LastfmSimilarResult {
  ok: boolean; // reachable (a "not found" answer still counts as ok -- it's not an error)
  candidates?: Array<{ name: string; match: number }>;
}

/** Last.fm artist.getsimilar, raw candidates in Last.fm's own match-descending
 * order. `fetchFn` is injectable so tests never hit the real API. */
export async function lastfmSimilarArtists(
  name: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  limit: number = LASTFM_RAW_LIMIT
): Promise<LastfmSimilarResult> {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&autocorrect=1&limit=${limit}`;
    const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } } as any);
    if (!res.ok) {
      // 400/404 from Last.fm on a bad param is effectively "not found", not transient.
      return { ok: res.status === 400 || res.status === 404 };
    }
    const json: any = await res.json();
    if (json?.error) {
      // Error code 6 = "artist not found" (a clean miss); anything else (e.g.
      // 29 = rate limited) is treated as unreachable so it's retried later.
      return { ok: json.error === 6 };
    }
    const raw = json?.similarartists?.artist;
    if (!Array.isArray(raw)) return { ok: true };

    const candidates = raw
      .map((a: any) => ({ name: typeof a?.name === 'string' ? a.name.trim() : '', match: parseFloat(a?.match) }))
      .filter((c: { name: string; match: number }) => c.name && Number.isFinite(c.match));
    return { ok: true, candidates };
  } catch {
    return { ok: false };
  }
}

/**
 * Cross-references Last.fm's raw candidates against our own whitelist (keyed by
 * normalized name), keeping only ones that resolve, up to `max`, preserving
 * Last.fm's match-descending order. Exported for testability.
 */
export function resolveSimilarArtists(
  candidates: Array<{ name: string; match: number }>,
  byNormName: Map<string, { name: string; slug: string }>,
  excludeNormName: string,
  max: number
): SimilarArtistRef[] {
  const out: SimilarArtistRef[] = [];
  for (const c of candidates) {
    const key = normName(c.name);
    if (key === excludeNormName) continue; // never list an artist as similar to itself
    const hit = byNormName.get(key);
    if (!hit) continue;
    out.push({ name: hit.name, slug: hit.slug, match: c.match });
    if (out.length >= max) break;
  }
  return out;
}

async function main() {
  const n = parseInt(process.argv[2] || '200', 10);
  const lastfmKey = process.env.LASTFM_API_KEY;
  if (!lastfmKey) {
    console.log('[enrich-similar] LASTFM_API_KEY not set -- Last.fm is the only source for this tier. Nothing to do.');
    return;
  }

  const artists = await loadDb();
  const pending = artists.filter((a) => !a.similarEnrichedAt && !a.similarTriedAt).slice(0, n);
  if (pending.length === 0) {
    console.log('[enrich-similar] Nothing pending for the similar-artists tier.');
    return;
  }

  // Built once from the whole whitelist -- cross-referencing every pending
  // artist's Last.fm candidates against this is then a plain Map lookup instead
  // of a linear scan per candidate per artist.
  const byNormName = new Map<string, { name: string; slug: string }>();
  for (const a of artists) {
    byNormName.set(normName(a.name), { name: a.name, slug: slugify(a.name) });
  }

  console.log(`[enrich-similar] Processing ${pending.length} artists...`);
  const now = () => new Date().toISOString();
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let processed = 0;

  for (const entry of pending) {
    const lf = await lastfmSimilarArtists(entry.name, lastfmKey);
    if (!lf.ok) {
      skipped++;
    } else {
      const resolved = resolveSimilarArtists(lf.candidates ?? [], byNormName, normName(entry.name), MAX_SIMILAR);
      if (resolved.length > 0) {
        entry.similarArtists = resolved;
        entry.similarEnrichedAt = now();
        hits++;
      } else {
        // Reachable, but nothing came back / nothing resolved to our whitelist
        // -> don't re-query this artist on future runs of this tier.
        entry.similarTriedAt = now();
        misses++;
      }
    }
    await sleep(250); // Last.fm's free tier is generous, but stay polite

    processed++;
    if (processed % FLUSH_EVERY === 0) {
      await saveDb(artists);
      console.log(`[enrich-similar] ...${processed}/${pending.length} (hits ${hits}, misses ${misses}, retry-later ${skipped})`);
    }
  }

  await saveDb(artists);
  console.log('[enrich-similar] Done.');
  console.log(`  processed     : ${processed}`);
  console.log(`  enriched (hit): ${hits}`);
  console.log(`  miss          : ${misses} (nothing resolved to our whitelist, won't be re-queried by this tier)`);
  console.log(`  retry-later   : ${skipped} (network errors, untouched)`);
}

// Guard so tests can import lastfmSimilarArtists/resolveSimilarArtists without
// triggering this file's own CLI run (CommonJS output -- see
// enrich_wikidata_bulk.ts for why require.main, not import.meta, is the right
// entrypoint check here).
if (require.main === module) {
  main().catch((err) => {
    console.error(`[enrich-similar] Fatal: ${err.message}`);
    process.exit(1);
  });
}
