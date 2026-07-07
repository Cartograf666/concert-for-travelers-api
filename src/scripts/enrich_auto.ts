import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Tier-0 deterministic artist enrichment: structured sources BEFORE any LLM.
 *
 * For each un-enriched artist it cascades three free, structured catalogs and
 * fills official website + social links WITHOUT a single Gemini call:
 *
 *   1. MusicBrainz  (no key)  — url-rels: homepage + Spotify/Instagram/Facebook/YouTube
 *   2. Wikidata     (no key)  — P856 site, P1902 Spotify, P2003 IG, P2013 FB, P2397 YT
 *   3. Spotify API  (key opt) — canonical Spotify URL for the artist
 *
 * Markers:
 *   enrichedAt + enrichedBy   set when a source contributes data. Gemini's
 *                             `select` (keyed on !enrichedAt) then skips it.
 *   autoTriedAt               set when every source was reachable but found
 *                             nothing, so the auto tier won't re-query it, yet
 *                             it stays pending (!enrichedAt) for the Gemini tier.
 *   (network error)           leaves the entry untouched so a later run retries.
 *
 * Usage: enrich_auto.ts [N]     process the next N pending artists (default 200)
 *
 * Resumable and idempotent. Do NOT run concurrently with `enrich_sites apply`
 * or the swarm — this process is the sole DB writer while it runs.
 */

interface Socials {
  spotify: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  telegram: string | null;
  vk: string | null;
}

interface ArtistEntry {
  name: string;
  website: string | null;
  tourUrl?: string | null;
  socials?: Socials;
  enrichedAt?: string;
  enrichedBy?: string;
  autoTriedAt?: string;
}

/** A single source's contribution. `ok` = the server was reachable (not a network error). */
interface Lookup {
  ok: boolean;
  website?: string | null;
  socials?: Partial<Socials>;
}

const DB_PATH = path.join(process.cwd(), 'data', 'approved_artists.json');
const TMP_PATH = DB_PATH + '.tmp';
const MB_UA = 'ConcertForTravelers/1.0 ( axell2479@gmail.com )'; // MusicBrainz requires an identifying UA
const FLUSH_EVERY = 25; // periodic atomic checkpoint so a crash loses at most this many

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptySocials(): Socials {
  return { spotify: null, instagram: null, facebook: null, youtube: null, telegram: null, vk: null };
}

function normName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Map a URL to the social field it represents (or 'website' for a plain homepage). */
function classifyUrl(url: string): keyof Socials | 'website' | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('spotify.com')) return 'spotify';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('facebook.com') || host.includes('fb.com')) return 'facebook';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host === 't.me' || host.includes('telegram.me') || host.includes('telegram.org')) return 'telegram';
  if (host.includes('vk.com') || host.includes('vk.ru')) return 'vk';
  return 'website';
}

async function httpGet(url: string, opts: { headers?: Record<string, string> } = {}): Promise<any> {
  const maxAttempts = 3;
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt); // linear backoff; caller already paces base rate
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': MB_UA, Accept: 'application/json', ...opts.headers },
        timeout: 15000
      });
      return res.data;
    } catch (err: any) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = status === 429 || status === undefined || status >= 500;
      if (!retryable || attempt === maxAttempts - 1) throw err;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Source 1: MusicBrainz (2 calls: search + url-rels lookup). Rate limit ~1 req/s.
// ---------------------------------------------------------------------------
async function musicbrainz(name: string): Promise<Lookup> {
  try {
    const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
    const search = await httpGet(`https://musicbrainz.org/ws/2/artist?query=${q}&fmt=json&limit=3`);
    await sleep(1100);

    const candidates: any[] = search?.artists ?? [];
    const target = normName(name);
    const best = candidates.find((a) => a.score >= 90 && normName(a.name) === target);
    if (!best) return { ok: true }; // reachable, no confident match

    const detail = await httpGet(`https://musicbrainz.org/ws/2/artist/${best.id}?inc=url-rels&fmt=json`);
    await sleep(1100);

    const socials: Partial<Socials> = {};
    let website: string | null = null;
    for (const rel of detail?.relations ?? []) {
      const url: string | undefined = rel?.url?.resource;
      if (!url) continue;
      const field = classifyUrl(url);
      if (field === 'website') {
        if (rel.type === 'official homepage' && !website) website = url;
      } else if (field && !socials[field]) {
        socials[field] = url;
      }
    }
    return { ok: true, website, socials };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Source 2: Wikidata (2 calls: entity search + claims). Polite ~200ms spacing.
// ---------------------------------------------------------------------------
const WD_INSTANCE_OK = new Set([
  'Q5',        // human
  'Q215380',   // musical group / band
  'Q2088357',  // musical ensemble
  'Q215627'    // person
]);

function claimString(claim: any): string | null {
  const v = claim?.mainsnak?.datavalue?.value;
  if (typeof v === 'string') return v;
  return null;
}

async function wikidata(name: string): Promise<Lookup> {
  try {
    const search = await httpGet(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`
    );
    await sleep(200);
    const id: string | undefined = search?.search?.[0]?.id;
    if (!id) return { ok: true };

    const ent = await httpGet(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=claims&format=json`
    );
    await sleep(200);
    const claims = ent?.entities?.[id]?.claims;
    if (!claims) return { ok: true };

    // Verify it's actually a musician/band before trusting the match.
    const instanceOf: string[] = (claims.P31 ?? []).map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
    if (instanceOf.length && !instanceOf.some((qid) => WD_INSTANCE_OK.has(qid))) {
      return { ok: true }; // reachable, but the top hit is not a music act
    }

    const socials: Partial<Socials> = {};
    let website: string | null = null;

    const p856 = claimString(claims.P856?.[0]);
    if (p856) website = p856;

    const spotifyId = claimString(claims.P1902?.[0]);
    if (spotifyId) socials.spotify = `https://open.spotify.com/artist/${spotifyId}`;

    const ig = claimString(claims.P2003?.[0]);
    if (ig) socials.instagram = `https://www.instagram.com/${ig.replace(/^@/, '')}`;

    const fb = claimString(claims.P2013?.[0]);
    if (fb) socials.facebook = `https://www.facebook.com/${fb}`;

    const yt = claimString(claims.P2397?.[0]);
    if (yt) socials.youtube = `https://www.youtube.com/channel/${yt}`;

    const vk = claimString(claims.P3185?.[0]);
    if (vk) socials.vk = `https://vk.com/${vk}`;

    const tg = claimString(claims.P3789?.[0]);
    if (tg) socials.telegram = `https://t.me/${tg.replace(/^@/, '')}`;

    return { ok: true, website, socials };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Source 3: Spotify (client-credentials). Only fills the Spotify URL.
// ---------------------------------------------------------------------------
let spotifyToken: string | null | undefined; // undefined = not yet fetched, null = unavailable

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken !== undefined) return spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    console.error('[enrich-auto] SPOTIFY_CLIENT_ID/SECRET not set — skipping Spotify tier.');
    spotifyToken = null;
    return null;
  }
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });
    spotifyToken = res.data?.access_token ?? null;
  } catch (err: any) {
    console.error(`[enrich-auto] Spotify token request failed: ${err.message}`);
    spotifyToken = null;
  }
  return spotifyToken ?? null;
}

async function spotify(name: string): Promise<Lookup> {
  const token = await getSpotifyToken();
  if (!token) return { ok: false }; // treat as not-attempted rather than a clean miss
  try {
    const res = await axios.get(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    await sleep(120);
    const artist = res.data?.artists?.items?.[0];
    if (!artist || normName(artist.name) !== normName(name)) return { ok: true };
    const url: string | undefined = artist.external_urls?.spotify;
    return { ok: true, socials: url ? { spotify: url } : {} };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Cascade + persistence
// ---------------------------------------------------------------------------
function hasAny(website: string | null, socials: Socials): boolean {
  return !!website || Object.values(socials).some(Boolean);
}

/** "Enough" data to stop early and save downstream calls. */
function enough(website: string | null, socials: Socials): boolean {
  return !!website && !!socials.spotify;
}

async function loadDb(): Promise<ArtistEntry[]> {
  return JSON.parse(await fs.readFile(DB_PATH, 'utf-8'));
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  artists.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(TMP_PATH, JSON.stringify(artists, null, 2), 'utf-8');
  await fs.rename(TMP_PATH, DB_PATH); // atomic swap
}

async function main() {
  const n = parseInt(process.argv[2] || '200', 10);
  const artists = await loadDb();

  const pending = artists.filter((a) => !a.enrichedAt && !a.autoTriedAt).slice(0, n);
  if (pending.length === 0) {
    console.log('[enrich-auto] Nothing pending for the auto tier. Run the Gemini tier for the remaining misses.');
    return;
  }
  console.log(`[enrich-auto] Processing ${pending.length} artists (of ${artists.filter((a) => !a.enrichedAt).length} un-enriched).`);

  const now = () => new Date().toISOString();
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let processed = 0;

  for (const entry of pending) {
    let websiteVal: string | null = entry.website || null;
    const socials = { ...emptySocials(), ...(entry.socials || {}) };
    const contributors: string[] = [];
    let anyReached = false;
    let anyError = false;

    const sources: Array<[string, (name: string) => Promise<Lookup>]> = [
      ['musicbrainz', musicbrainz],
      ['wikidata', wikidata],
      ['spotify', spotify]
    ];

    for (const [srcName, fn] of sources) {
      if (enough(websiteVal, socials)) break;
      const res = await fn(entry.name);
      if (!res.ok) { anyError = true; continue; }
      anyReached = true;
      let contributed = false;
      if (res.website && !websiteVal) { websiteVal = res.website; contributed = true; }
      for (const [k, val] of Object.entries(res.socials || {})) {
        const key = k as keyof Socials;
        if (val && !socials[key]) { socials[key] = val; contributed = true; }
      }
      if (contributed) contributors.push(srcName);
    }

    if (hasAny(websiteVal, socials)) {
      entry.website = websiteVal;
      entry.socials = socials;
      entry.enrichedAt = now();
      entry.enrichedBy = contributors.join('+') || 'auto';
      hits++;
    } else if (anyReached && !anyError) {
      // Cleanly searched everywhere, found nothing -> hand off to the Gemini tier.
      entry.autoTriedAt = now();
      misses++;
    } else {
      // Some source errored; leave untouched so a later run retries it.
      skipped++;
    }

    processed++;
    if (processed % FLUSH_EVERY === 0) {
      await saveDb(artists);
      console.log(`[enrich-auto] ...${processed}/${pending.length} (hits ${hits}, misses ${misses}, retry-later ${skipped})`);
    }
  }

  await saveDb(artists);
  console.log('[enrich-auto] Done.');
  console.log(`  processed     : ${processed}`);
  console.log(`  enriched (hit): ${hits}`);
  console.log(`  auto-miss     : ${misses} (left pending for Gemini tier)`);
  console.log(`  retry-later   : ${skipped} (network errors, untouched)`);
}

main().catch((err) => {
  console.error(`[enrich-auto] Fatal: ${err.message}`);
  process.exit(1);
});
