import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Grows data/artist_scrape_targets.txt from live popularity charts, so the set of
 * artists we actively pull concerts for tracks who's actually popular worldwide
 * instead of a hand-maintained list. Deezer's chart API is used because it needs no
 * key (immediate, zero setup) and returns real current top artists globally and per
 * genre. Idempotent + append-only: only never-seen names are added, existing lines
 * (including the user's own hand-added favorites) are preserved untouched.
 *
 * Design note: an LLM is deliberately NOT used to "generate" the list -- it would be
 * stale (training cutoff) and hallucinate. A chart API is live ground truth. Spotify
 * (per-country Top-50 + viral/"rising" charts + a popularity score) is the natural
 * quality upgrade once a free SPOTIFY_CLIENT_ID/SECRET is available; this script is
 * structured so that source can be added alongside Deezer without reworking it.
 */

const DEEZER = 'https://api.deezer.com';
const LASTFM = 'https://ws.audioscrobbler.com/2.0/';

// Major touring markets worldwide -- Last.fm's geo.getTopArtists is per-country, so
// this is what turns a single "global top" into genuinely worldwide coverage
// (Deezer's keyless chart alone skews heavily to its home market).
const LASTFM_COUNTRIES = [
  'United States', 'United Kingdom', 'Germany', 'France', 'Spain', 'Italy',
  'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Russia',
  'Ukraine', 'Turkey', 'Brazil', 'Mexico', 'Argentina', 'Canada', 'Australia',
  'Japan', 'South Korea', 'China', 'India', 'Indonesia', 'Thailand', 'Philippines',
  'Malaysia', 'Singapore', 'Vietnam', 'Portugal', 'Ireland', 'Belgium', 'Austria',
  'Switzerland', 'Greece', 'Czech Republic', 'Hungary', 'Romania', 'South Africa'
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Top artists globally + within each editorial genre (broad popularity coverage). */
async function fetchDeezerTopArtists(limit = 100): Promise<string[]> {
  const names = new Set<string>();

  const addFrom = (data: any) => {
    for (const a of data?.data ?? []) {
      if (a?.name && typeof a.name === 'string') names.add(a.name.trim());
    }
  };

  // Global chart.
  try {
    addFrom(await getJson(`${DEEZER}/chart/0/artists?limit=${limit}`));
  } catch (e: any) {
    console.warn(`[Discover] Deezer global chart failed: ${e.message}`);
  }

  // Per-genre charts.
  let genres: Array<{ id: number; name: string }> = [];
  try {
    genres = (await getJson(`${DEEZER}/genre`))?.data ?? [];
  } catch (e: any) {
    console.warn(`[Discover] Deezer genre list failed: ${e.message}`);
  }
  for (const g of genres) {
    if (!g?.id) continue;
    try {
      addFrom(await getJson(`${DEEZER}/chart/${g.id}/artists?limit=${limit}`));
    } catch (e: any) {
      console.warn(`[Discover] Deezer genre ${g.name} chart failed: ${e.message}`);
    }
    await sleep(250); // stay well under Deezer's rate limit
  }

  return [...names];
}

/** Worldwide popular artists via Last.fm: global chart + per-country top artists.
 * Requires a free LASTFM_API_KEY; returns [] (with a note) when the key is absent,
 * so Deezer alone still works with zero setup. */
async function fetchLastfmTopArtists(apiKey: string, limit = 100): Promise<string[]> {
  const names = new Set<string>();
  const addFrom = (json: any) => {
    for (const a of json?.topartists?.artist ?? []) {
      if (a?.name && typeof a.name === 'string') names.add(a.name.trim());
    }
  };

  try {
    addFrom(await getJson(`${LASTFM}?method=chart.gettopartists&api_key=${apiKey}&format=json&limit=${limit}`));
  } catch (e: any) {
    console.warn(`[Discover] Last.fm global chart failed: ${e.message}`);
  }

  for (const country of LASTFM_COUNTRIES) {
    try {
      const url = `${LASTFM}?method=geo.gettopartists&country=${encodeURIComponent(country)}&api_key=${apiKey}&format=json&limit=${limit}`;
      addFrom(await getJson(url));
    } catch (e: any) {
      console.warn(`[Discover] Last.fm ${country} failed: ${e.message}`);
    }
    await sleep(250);
  }

  return [...names];
}

async function main() {
  const targetsPath = path.join(process.cwd(), 'data', 'artist_scrape_targets.txt');

  const existingRaw = await fs.readFile(targetsPath, 'utf-8').catch(() => '');
  const existingLines = existingRaw.split('\n');
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const have = new Set(existingLines.map(norm).filter(Boolean));

  const discoveredSet = new Set<string>();
  const deezer = await fetchDeezerTopArtists();
  deezer.forEach((n) => discoveredSet.add(n));
  console.log(`[Discover] Deezer returned ${deezer.length} distinct chart artists.`);

  const lastfmKey = process.env.LASTFM_API_KEY;
  if (lastfmKey) {
    const lastfm = await fetchLastfmTopArtists(lastfmKey);
    lastfm.forEach((n) => discoveredSet.add(n));
    console.log(`[Discover] Last.fm returned ${lastfm.length} distinct chart artists across ${LASTFM_COUNTRIES.length} countries.`);
  } else {
    console.log('[Discover] LASTFM_API_KEY not set -- skipping Last.fm (worldwide per-country) source. Deezer only.');
  }
  const discovered = [...discoveredSet];

  const toAdd: string[] = [];
  const seenNew = new Set<string>();
  for (const name of discovered) {
    const key = norm(name);
    if (!key || have.has(key) || seenNew.has(key)) continue;
    seenNew.add(key);
    toAdd.push(name);
  }

  if (toAdd.length === 0) {
    console.log('[Discover] No new chart artists to add -- target list already covers them.');
    return;
  }

  // Append (preserve existing order/content); ensure a single trailing newline.
  const base = existingRaw.endsWith('\n') || existingRaw === '' ? existingRaw : existingRaw + '\n';
  const next = base + toAdd.join('\n') + '\n';
  await fs.writeFile(targetsPath, next, 'utf-8');

  console.log(`[Discover] Added ${toAdd.length} new popular artists to the target list.`);
  console.log(`[Discover] Sample: ${toAdd.slice(0, 15).join(', ')}${toAdd.length > 15 ? ' ...' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
