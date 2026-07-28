import { loadDb as loadDbShared, saveDb as saveDbShared, normName, sleep } from './enrich_wikidata_bulk.js';
import { ArtistEntry } from '../schemas/artist.js';

/**
 * Tier-3 fallback image enrichment for artists enrich_metadata.ts's Deezer lookup
 * never matched (strict exact-name-match there is intentionally conservative, so
 * it misses a lot of the long tail). Own pending-gate (imageFallbackTriedAt),
 * separate from metaEnrichedAt/metaTriedAt, so this only ever visits an artist
 * once regardless of what enrich_metadata.ts already decided.
 *
 * Two keyless sources, tried in order per artist:
 *   1. Wikidata P18 (artist photo), looked up by MBID via a batched VALUES SPARQL
 *      query against MusicBrainz artist ID (P434) -- same endpoint/UA/pacing
 *      convention as enrich_wikidata_bulk.ts. Matching by mbid instead of by name
 *      means no ambiguity risk, but only reaches artists that already have one
 *      (from enrich_auto.ts / enrich_wikidata_bulk.ts / backfill_mbid.ts).
 *   2. TheAudioDB search.php (public community test key, no signup/registration)
 *      by name, for whatever's left -- same exact-normalized-name confidence gate
 *      as Deezer's deezerArtistImage (a wrong photo is worse than no photo).
 *
 * Markers:
 *   imageFallbackTriedAt   set once both reachable sources were checked for an
 *                          artist (hit or clean miss). A network error leaves the
 *                          artist untouched so a later run retries it.
 *
 * Usage: enrich_artist_images.ts [N]     process the next N pending artists (default 2000)
 *
 * Resumable and idempotent. Do NOT run concurrently with another artist-DB
 * (data/artists/) writer -- same single-writer-per-process convention as the
 * other enrich_*.ts scripts.
 */

const WD_ENDPOINT = 'https://query.wikidata.org/sparql';
const WD_UA = 'ConcertForTravelers/1.0 ( axell2479@gmail.com )'; // Wikidata requires an identifying UA
const AUDIODB_KEY = '523532'; // TheAudioDB's public community test key -- no signup, shared rate limit
const MBID_BATCH = 200;
const FLUSH_EVERY = 25;

// Thin type-adapting wrappers, same pattern as backfill_mbid.ts/enrich_metadata.ts:
// enrich_wikidata_bulk.ts's loadDb/saveDb are typed against its own (narrower)
// ArtistEntry, which doesn't know about this file's image/imageSource/
// imageFallbackTriedAt fields.
async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadDbShared()) as unknown as ArtistEntry[];
}
async function saveDb(artists: ArtistEntry[]): Promise<void> {
  return saveDbShared(artists as any);
}

/** Wikidata SPARQL already returns P18 as a full Special:FilePath URL
 * (http://commons.wikimedia.org/wiki/Special:FilePath/Name.jpg) -- just upgrade to https. */
function commonsFilePathUrl(raw: string): string {
  return raw.replace(/^http:\/\//, 'https://');
}

export function buildMbidImageQuery(mbids: string[]): string {
  const values = mbids.map((m) => `"${m}"`).join(' ');
  return `SELECT ?mbid ?image WHERE {
  VALUES ?mbid { ${values} }
  ?item wdt:P434 ?mbid .
  ?item wdt:P18 ?image .
}`;
}

/** Batched Wikidata lookup: artist photo (P18) by MusicBrainz ID (P434). Retries
 * a transient failure (429/5xx/network) a couple times before giving up, same
 * backoff shape as enrich_wikidata_bulk.ts's queryBatch. `fetchFn` is injectable
 * so tests never hit the real endpoint. */
export async function queryImagesByMbid(mbids: string[], fetchFn: typeof fetch = fetch): Promise<Map<string, string>> {
  const byMbid = new Map<string, string>();
  if (mbids.length === 0) return byMbid;

  const query = buildMbidImageQuery(mbids);
  const url = `${WD_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;

  let attempt = 0;
  let json: any;
  while (true) {
    let res: Response;
    try {
      res = (await fetchFn(url, { headers: { 'User-Agent': WD_UA, Accept: 'application/sparql-results+json' } } as any)) as Response;
    } catch (err) {
      // Network-level failure (DNS/timeout/reset) -- always worth a retry.
      if (attempt >= 2) throw err;
      attempt++;
      await sleep(2000 * attempt);
      continue;
    }

    if (res.ok) {
      json = await res.json();
      break;
    }

    // An HTTP-level error response (res.ok === false) is not a thrown exception,
    // so it must be handled outside the catch above -- otherwise a non-retryable
    // 4xx would fall into the network-error branch and get retried anyway.
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) throw new Error(`Wikidata SPARQL HTTP ${res.status}`);
    attempt++;
    await sleep(2000 * attempt);
  }

  for (const b of json?.results?.bindings ?? []) {
    const mbid = b.mbid?.value;
    const image = b.image?.value;
    if (mbid && image && !byMbid.has(mbid)) byMbid.set(mbid, commonsFilePathUrl(image));
  }
  return byMbid;
}

interface AudioDbResult {
  ok: boolean; // reachable (a "not found" answer still counts as ok -- it's not an error)
  image?: string;
}

/** TheAudioDB search.php (keyless-in-practice public test key) for a press photo.
 * Only trusts an exact (normalized) name match on the top result, same rationale
 * as deezerArtistImage in enrich_metadata.ts. `fetchFn` is injectable for tests. */
export async function audioDbArtistImage(name: string, fetchFn: typeof fetch = fetch): Promise<AudioDbResult> {
  try {
    const url = `https://www.theaudiodb.com/api/v1/json/${AUDIODB_KEY}/search.php?s=${encodeURIComponent(name)}`;
    const res = await fetchFn(url);
    if (!res.ok) return { ok: false };
    const json: any = await res.json();
    const hit = json?.artists?.[0];
    if (!hit?.strArtist) return { ok: true };
    if (normName(hit.strArtist) !== normName(name)) return { ok: true }; // not a confident match
    const image: string | undefined = hit.strArtistThumb || hit.strArtistFanart || hit.strArtistLogo || undefined;
    return { ok: true, image };
  } catch {
    return { ok: false };
  }
}

export function selectPendingImageArtists(artists: ArtistEntry[], n: number): ArtistEntry[] {
  return artists.filter((a) => !a.image && !a.imageFallbackTriedAt).slice(0, n);
}

async function main() {
  const n = parseInt(process.argv[2] || '2000', 10);
  const artists = await loadDb();

  const pending = selectPendingImageArtists(artists, n);
  if (pending.length === 0) {
    console.log('[enrich-images] Nothing pending for the image fallback tier.');
    return;
  }
  console.log(`[enrich-images] Processing ${pending.length} artists (Wikidata-by-mbid + TheAudioDB fallback)...`);

  // Pre-resolve the Wikidata tier for everyone with an mbid, batched, before the
  // per-artist loop below -- one SPARQL query per MBID_BATCH artists instead of one
  // network round-trip each. A batch that errors just leaves those mbids out of
  // the map (imagesByMbid) and marks them in mbidQueryFailed so the per-artist
  // loop knows to treat a "miss" there as "unreachable", not "confirmed absent".
  const withMbid = pending.filter((a) => a.mbid);
  const imagesByMbid = new Map<string, string>();
  const mbidQueryFailed = new Set<string>();
  for (let i = 0; i < withMbid.length; i += MBID_BATCH) {
    const batch = withMbid.slice(i, i + MBID_BATCH);
    const mbids = batch.map((a) => a.mbid!);
    try {
      const resolved = await queryImagesByMbid(mbids);
      for (const [mbid, image] of resolved) imagesByMbid.set(mbid, image);
    } catch (err: any) {
      console.error(`[enrich-images] Wikidata mbid batch failed (${err.message}); those artists retried next run if TheAudioDB also misses.`);
      for (const mbid of mbids) mbidQueryFailed.add(mbid);
    }
    await sleep(1200); // polite spacing between SPARQL queries, same as enrich_wikidata_bulk.ts
  }

  const now = () => new Date().toISOString();
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let processed = 0;

  for (const entry of pending) {
    let anyError = false;
    let contributed = false;

    if (entry.mbid) {
      if (mbidQueryFailed.has(entry.mbid)) {
        anyError = true;
      } else {
        const image = imagesByMbid.get(entry.mbid);
        if (image) {
          entry.image = image;
          entry.imageSource = 'wikidata';
          contributed = true;
        }
      }
    }

    if (!contributed) {
      const ad = await audioDbArtistImage(entry.name);
      if (!ad.ok) {
        anyError = true;
      } else if (ad.image) {
        entry.image = ad.image;
        entry.imageSource = 'audiodb';
        contributed = true;
      }
      await sleep(300); // stay polite on the shared community test key
    }

    if (contributed) {
      entry.imageFallbackTriedAt = now();
      hits++;
    } else if (!anyError) {
      // Cleanly checked everywhere reachable, found nothing -> don't re-query
      // this artist on future runs of this tier.
      entry.imageFallbackTriedAt = now();
      misses++;
    } else {
      // A source errored -- leave untouched so a later run retries it.
      skipped++;
    }

    processed++;
    if (processed % FLUSH_EVERY === 0) {
      await saveDb(artists);
      console.log(`[enrich-images] ...${processed}/${pending.length} (hits ${hits}, misses ${misses}, retry-later ${skipped})`);
    }
  }

  await saveDb(artists);
  console.log('[enrich-images] Done.');
  console.log(`  processed     : ${processed}`);
  console.log(`  enriched (hit): ${hits}`);
  console.log(`  miss          : ${misses} (nothing found, won't be re-queried by this tier)`);
  console.log(`  retry-later   : ${skipped} (network errors, untouched)`);
}

// Guard so tests can import the pure helpers without triggering this file's own
// CLI run (CommonJS output -- see enrich_wikidata_bulk.ts for why require.main,
// not import.meta, is the right entrypoint check here).
if (require.main === module) {
  main().catch((err) => {
    console.error(`[enrich-images] Fatal: ${err.message}`);
    process.exit(1);
  });
}
