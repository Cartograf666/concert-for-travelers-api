import { loadDb as loadDbShared, saveDb as saveDbShared, normName, sleep } from './enrich_wikidata_bulk.js';
import { ArtistEntry } from '../schemas/artist.js';

/**
 * Tier-2 artist metadata enrichment: genres/tags + popularity (Last.fm, needs a
 * free LASTFM_API_KEY -- already used by discover_artists.ts) and an artist image
 * (Deezer artist search, no key needed). Deliberately a SEPARATE pending-gate
 * (metaEnrichedAt/metaTriedAt) from the identity enrichment tiers (enrich_auto.ts,
 * enrich_wikidata_bulk.ts) -- most of the whitelist already has enrichedAt set from
 * those, which would permanently exclude it from ever being visited again if this
 * reused the same marker, even though genres/popularity/image are a wholly separate
 * concern that hasn't been attempted yet for any of them.
 *
 * One Last.fm artist.getInfo call yields both genres (top user-applied tags) AND
 * popularity (listeners/playcount stats) -- no need for two round-trips.
 *
 * Markers:
 *   metaEnrichedAt   set when a source contributes at least one of genres/
 *                    popularity/image.
 *   metaTriedAt      set when every reachable source was queried and contributed
 *                    nothing (or there was nothing to query, e.g. no API key and
 *                    an image already present) -- won't be re-queried by this tier.
 *   (network error)  entry left untouched so a later run retries it.
 *
 * Usage: enrich_metadata.ts [N]     process the next N pending artists (default 200)
 *
 * Resumable and idempotent. Do NOT run concurrently with another artist-DB (data/artists/)
 * writer -- same single-writer-per-process convention as the other enrich_*.ts scripts.
 */
interface Popularity {
  listeners: number;
  playcount: number;
}

const FLUSH_EVERY = 25;

// Thin type-adapting wrappers: enrich_wikidata_bulk.ts's loadDb/saveDb are typed
// against its own (narrower) ArtistEntry, which doesn't know about this file's
// genres/popularity/image/metaEnrichedAt/metaTriedAt fields -- reuse the actual
// read/write/sort/atomic-rename logic instead of re-implementing it a second
// time (see backfill_mbid.ts, which reuses the same exports directly).
async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadDbShared()) as unknown as ArtistEntry[];
}
async function saveDb(artists: ArtistEntry[]): Promise<void> {
  return saveDbShared(artists as any);
}

interface LastfmResult {
  ok: boolean; // reachable (a "not found" answer still counts as ok -- it's not an error)
  genres?: string[];
  popularity?: Popularity;
}

/** Last.fm artist.getInfo: one call for both top tags (genres) and listener/playcount
 * stats. `fetchFn` is injectable so tests never hit the real API. */
export async function lastfmArtistInfo(
  name: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<LastfmResult> {
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${apiKey}&format=json&autocorrect=1`;
    const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0' } } as any);
    if (!res.ok) {
      // 400/404 from Last.fm on a bad param is effectively "not found", not transient.
      return { ok: res.status === 400 || res.status === 404 };
    }
    const json: any = await res.json();
    if (json?.error) {
      // Last.fm error code 6 = "artist not found" (a clean miss); anything else
      // (e.g. 29 = rate limited) is treated as unreachable so it's retried later.
      return { ok: json.error === 6 };
    }
    const artist = json?.artist;
    if (!artist) return { ok: true };

    const genres: string[] = (artist.tags?.tag ?? [])
      .map((t: any) => (typeof t?.name === 'string' ? t.name.trim() : ''))
      .filter(Boolean)
      .slice(0, 5);

    const listeners = parseInt(artist.stats?.listeners, 10);
    const playcount = parseInt(artist.stats?.playcount, 10);
    const popularity = Number.isFinite(listeners) && Number.isFinite(playcount) ? { listeners, playcount } : undefined;

    return { ok: true, genres: genres.length > 0 ? genres : undefined, popularity };
  } catch {
    return { ok: false };
  }
}

interface DeezerResult {
  ok: boolean;
  image?: string;
}

/** Deezer artist search (keyless) for a thumbnail image. Only trusts an exact
 * (normalized) name match on the top result -- Deezer's free-text search can
 * return an unrelated result for an obscure/niche name, and a wrong image is
 * worse than no image. */
export async function deezerArtistImage(name: string, fetchFn: typeof fetch = fetch): Promise<DeezerResult> {
  try {
    const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`;
    const res = await fetchFn(url);
    if (!res.ok) return { ok: false };
    const json: any = await res.json();
    const hit = json?.data?.[0];
    if (!hit?.name) return { ok: true };
    if (normName(hit.name) !== normName(name)) return { ok: true }; // not a confident match
    const image: string | undefined = hit.picture_medium || hit.picture || hit.picture_small || undefined;
    return { ok: true, image };
  } catch {
    return { ok: false };
  }
}

async function main() {
  const n = parseInt(process.argv[2] || '200', 10);
  const artists = await loadDb();
  const lastfmKey = process.env.LASTFM_API_KEY;

  const pending = artists.filter((a) => !a.metaEnrichedAt && !a.metaTriedAt).slice(0, n);
  if (pending.length === 0) {
    console.log('[enrich-metadata] Nothing pending for the metadata tier.');
    return;
  }
  console.log(
    `[enrich-metadata] Processing ${pending.length} artists` +
    (lastfmKey ? '' : ' (LASTFM_API_KEY not set -- genres/popularity skipped, image-only via Deezer)') + '...'
  );

  const now = () => new Date().toISOString();
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let processed = 0;

  for (const entry of pending) {
    let anyError = false;
    let contributed = false;

    if (lastfmKey) {
      const lf = await lastfmArtistInfo(entry.name, lastfmKey);
      if (!lf.ok) {
        anyError = true;
      } else {
        if (lf.genres) { entry.genres = lf.genres; contributed = true; }
        if (lf.popularity) { entry.popularity = lf.popularity; contributed = true; }
      }
      await sleep(250); // Last.fm's free tier is generous, but stay polite
    }

    if (!entry.image) {
      const dz = await deezerArtistImage(entry.name);
      if (!dz.ok) {
        anyError = true;
      } else if (dz.image) {
        entry.image = dz.image;
        contributed = true;
      }
      await sleep(150);
    }

    if (contributed) {
      entry.metaEnrichedAt = now();
      hits++;
    } else if (!anyError) {
      // Cleanly checked everywhere reachable (or nothing left to check), found
      // nothing new -> don't re-query this artist on future runs of this tier.
      entry.metaTriedAt = now();
      misses++;
    } else {
      // A source errored -- leave untouched so a later run retries it.
      skipped++;
    }

    processed++;
    if (processed % FLUSH_EVERY === 0) {
      await saveDb(artists);
      console.log(`[enrich-metadata] ...${processed}/${pending.length} (hits ${hits}, misses ${misses}, retry-later ${skipped})`);
    }
  }

  await saveDb(artists);
  console.log('[enrich-metadata] Done.');
  console.log(`  processed     : ${processed}`);
  console.log(`  enriched (hit): ${hits}`);
  console.log(`  miss          : ${misses} (nothing found, won't be re-queried by this tier)`);
  console.log(`  retry-later   : ${skipped} (network errors, untouched)`);
}

// Guard so tests can import lastfmArtistInfo/deezerArtistImage without triggering
// this file's own CLI run (CommonJS output -- see enrich_wikidata_bulk.ts for why
// require.main, not import.meta, is the right entrypoint check here).
if (require.main === module) {
  main().catch((err) => {
    console.error(`[enrich-metadata] Fatal: ${err.message}`);
    process.exit(1);
  });
}
