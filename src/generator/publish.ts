import * as fs from 'fs/promises';
import * as path from 'path';
import { Concert } from '../schemas/concert.js';
import { slugify, parseSpotifyArtistId } from '../pipeline/process.js';

export interface PublishStats {
  totalConcerts: number;
  uniqueArtists: number;
  uniqueCities: number;
  pageCount: number;
  pageSize: number;
}

export const CONCERTS_PAGE_SIZE = 500;

// Bump whenever the shape of a Concert object changes in a way a consumer
// should know about (a field added, its meaning changed, or a field removed).
// No fields have ever been removed/renamed yet -- purely additive changes are
// backwards-compatible for a consumer that ignores unknown fields, so this
// isn't a hard compatibility gate, just a cheap signal of "something changed,
// go check src/schemas/concert.ts" for a consumer that wants to notice.
export const CONCERT_SCHEMA_VERSION = 1;

export interface PublishIndex {
  schemaVersion: number;
  lastRun: string;
  stats: PublishStats;
  artists: string[];
  cities: string[];
}

export interface ArtistCatalogEntry {
  slug: string;
  name: string;
  website?: string;
  socials?: Record<string, string>;
  spotifyId?: string;
  mbid?: string;
  genres?: string[];
  popularity?: { listeners: number; playcount: number };
  image?: string;
  similarArtists?: Array<{ name: string; slug: string; match: number }>;
  aliases?: string[];
}

/**
 * Publishes the FULL approved-artist directory (not just artists with a current
 * concert) as dist/artists.json, keyed by the same slug the per-artist concert
 * files already use. Two jobs this unlocks for the consumer app:
 *   1. A stable-enough join key (slug always present; spotifyId/mbid when known)
 *      so it can load this once and join to concerts.json/artists/{slug}.json
 *      without re-shipping name/socials/genres on every single concert.
 *   2. A full "add the artists you love" autocomplete directory -- index.json
 *      only lists artists that already have a scraped concert, which is far
 *      fewer than the ~63k-entry whitelist a user might search for.
 * A raw string entry (legacy shape, no metadata) still gets a minimal
 * {slug, name} record so the directory is always complete.
 */
export async function publishArtistCatalog(approvedArtists: any[], outputDir: string): Promise<void> {
  const bySlug = new Map<string, ArtistCatalogEntry>();

  for (const a of approvedArtists) {
    const name: string | undefined = typeof a === 'string' ? a : a?.name;
    if (!name) continue;
    const slug = slugify(name);
    if (bySlug.has(slug)) continue; // first entry wins on a slug collision (same documented limitation as per-artist concert files)

    const entry: ArtistCatalogEntry = { slug, name };
    if (typeof a !== 'string') {
      if (a.website) entry.website = a.website;
      if (a.socials && typeof a.socials === 'object') {
        const socials: Record<string, string> = {};
        for (const [k, v] of Object.entries(a.socials)) {
          if (typeof v === 'string' && v) socials[k] = v;
        }
        if (Object.keys(socials).length > 0) {
          entry.socials = socials;
          const spotifyId = parseSpotifyArtistId(socials.spotify);
          if (spotifyId) entry.spotifyId = spotifyId;
        }
      }
      if (a.mbid) entry.mbid = a.mbid;
      if (Array.isArray(a.genres) && a.genres.length > 0) entry.genres = a.genres;
      if (a.popularity && typeof a.popularity.listeners === 'number') entry.popularity = a.popularity;
      if (a.image) entry.image = a.image;
      if (Array.isArray(a.similarArtists)) {
        const similar = a.similarArtists
          .filter((s: any) => s?.name && s?.slug && typeof s?.match === 'number')
          .map((s: any) => ({ name: s.name, slug: s.slug, match: s.match }));
        if (similar.length > 0) entry.similarArtists = similar;
      }
      if (Array.isArray(a.aliases) && a.aliases.length > 0) entry.aliases = a.aliases;
    }
    bySlug.set(slug, entry);
  }

  const catalog = Array.from(bySlug.values()).sort((x, y) => x.name.localeCompare(y.name));
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'artists.json'), JSON.stringify(catalog), 'utf-8');
  console.log(`[Publisher] Published artist catalog: ${catalog.length} artists -> dist/artists.json`);
}

const EARTH_RADIUS_KM = 6371;
// How close two same-country venues must be (by geocoded lat/lng) to land in the
// same city bucket. Chosen to comfortably cover the confirmed real case that
// motivated this (Tokyo ward names -- Shibuya City/Koto City/Minato-ku/Ota-ku --
// plus Tokorozawa ~30km out, all scraped under their own literal city string
// instead of "Tokyo") with a little margin. A smaller radius would miss that
// case; a much larger one risks merging genuinely distinct major cities that
// happen to sit close together (e.g. Rotterdam/The Hague, Cologne/Düsseldorf) --
// there's no radius that's globally perfect, this is the documented tradeoff.
const CLUSTER_RADIUS_KM = 35;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

interface CityRep {
  country: string;
  city: string;
  latSum: number;
  lngSum: number;
  geoCount: number;
  totalCount: number;
}

/**
 * Fixes city-name fragmentation (kanji vs romaji, ward vs metro, transliteration
 * variants) by clustering same-country venues within CLUSTER_RADIUS_KM of each
 * other -- using lat/lng already geocoded per-venue -- into one canonical city
 * bucket, instead of trusting each source's raw scraped city string verbatim.
 * A concert missing lat/lng can't be clustered and keeps its own raw city string
 * as a singleton bucket (unchanged prior behavior for those).
 *
 * Returns a map from "country|rawCityString" -> canonical city name to
 * group/display under.
 */
function buildCityCanonicalMap(concerts: Concert[]): Map<string, string> {
  // One representative point per distinct (country, raw city string): centroid
  // of whichever of its concerts have lat/lng, plus a concert count used to pick
  // the canonical name later (most-represented raw string wins).
  const reps = new Map<string, CityRep>();
  for (const c of concerts) {
    const key = `${c.country}|${c.city}`;
    let rep = reps.get(key);
    if (!rep) {
      rep = { country: c.country, city: c.city, latSum: 0, lngSum: 0, geoCount: 0, totalCount: 0 };
      reps.set(key, rep);
    }
    rep.totalCount++;
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      rep.latSum += c.lat;
      rep.lngSum += c.lng;
      rep.geoCount++;
    }
  }

  const repKeys = Array.from(reps.keys());
  const repList = repKeys.map((key) => {
    const r = reps.get(key)!;
    return {
      key,
      country: r.country,
      city: r.city,
      totalCount: r.totalCount,
      lat: r.geoCount > 0 ? r.latSum / r.geoCount : null,
      lng: r.geoCount > 0 ? r.lngSum / r.geoCount : null,
    };
  });

  // Union-find over reps that have a centroid, same country, within radius.
  // Distinct (country, city) pairs are typically in the low thousands even for
  // an 11k+ concert catalog, so the O(n^2) comparison here is negligible.
  const parent = repList.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(i: number, j: number): void {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < repList.length; i++) {
    if (repList[i].lat === null) continue;
    for (let j = i + 1; j < repList.length; j++) {
      if (repList[j].lat === null || repList[i].country !== repList[j].country) continue;
      if (haversineKm(repList[i].lat!, repList[i].lng!, repList[j].lat!, repList[j].lng!) <= CLUSTER_RADIUS_KM) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, typeof repList>();
  for (let i = 0; i < repList.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(repList[i]);
  }

  const canonicalMap = new Map<string, string>();
  for (const members of clusters.values()) {
    const canonical = [...members].sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      if (b.city.length !== a.city.length) return b.city.length - a.city.length;
      return a.city.localeCompare(b.city);
    })[0].city;
    for (const m of members) canonicalMap.set(m.key, canonical);
  }

  return canonicalMap;
}

/**
 * Deletes {slug}.json files in a directory that are not part of the current run,
 * so entities that stopped touring don't linger as fetchable ghost endpoints.
 */
async function pruneOrphans(dir: string, keepSlugs: Set<string>): Promise<void> {
  let existing: string[];
  try {
    existing = await fs.readdir(dir);
  } catch {
    return; // Directory not created yet — nothing to prune.
  }
  for (const file of existing) {
    if (!file.endsWith('.json')) continue;
    if (!keepSlugs.has(file.slice(0, -'.json'.length))) {
      await fs.rm(path.join(dir, file), { force: true });
    }
  }
}

/**
 * Publishes normalized concert data as split static JSON API endpoints in the output directory.
 */
export async function publishConcerts(concerts: Concert[], outputDir: string): Promise<void> {
  const artistsDir = path.join(outputDir, 'artists');
  const citiesDir = path.join(outputDir, 'cities');

  // Ensure fresh output directories
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(artistsDir, { recursive: true });
  await fs.mkdir(citiesDir, { recursive: true });

  // Sort the list of concerts before publishing by: date ASC, then artist ASC, then city ASC.
  concerts.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    const artistCompare = a.artist.localeCompare(b.artist);
    if (artistCompare !== 0) return artistCompare;
    return a.city.localeCompare(b.city);
  });

  // 1. Group concerts by artist and city (city grouping goes through the geo
  // canonical map so ward/kanji/transliteration fragments of the same metro
  // land in one bucket -- see buildCityCanonicalMap).
  const cityCanonicalMap = buildCityCanonicalMap(concerts);
  const concertsByArtist = new Map<string, Concert[]>();
  const concertsByCity = new Map<string, Concert[]>();
  const uniqueArtists = new Set<string>();
  const uniqueCities = new Set<string>();

  for (const concert of concerts) {
    uniqueArtists.add(concert.artist);
    const canonicalCity = cityCanonicalMap.get(`${concert.country}|${concert.city}`) ?? concert.city;
    uniqueCities.add(canonicalCity);

    const artistSlug = slugify(concert.artist);
    if (!concertsByArtist.has(artistSlug)) {
      concertsByArtist.set(artistSlug, []);
    }
    concertsByArtist.get(artistSlug)!.push(concert);

    const citySlug = slugify(canonicalCity);
    if (!concertsByCity.has(citySlug)) {
      concertsByCity.set(citySlug, []);
    }
    concertsByCity.get(citySlug)!.push(concert);
  }

  // Sort lists for deterministic output
  const sortedArtists = Array.from(uniqueArtists).sort();
  const sortedCities = Array.from(uniqueCities).sort();

  // Remove stale per-slug files from prior runs before writing the current set.
  await pruneOrphans(artistsDir, new Set(concertsByArtist.keys()));
  await pruneOrphans(citiesDir, new Set(concertsByCity.keys()));

  // 2. Write master concert list: dist/concerts.json
  await fs.writeFile(
    path.join(outputDir, 'concerts.json'),
    JSON.stringify(concerts),
    'utf-8'
  );

  const writePromises: Promise<void>[] = [];

  // 3. Write individual artist files: dist/artists/{slug}.json
  for (const [artistSlug, artistConcerts] of concertsByArtist.entries()) {
    // Sort concerts by date ascending
    artistConcerts.sort((a, b) => a.date.localeCompare(b.date));
    writePromises.push(
      fs.writeFile(
        path.join(artistsDir, `${artistSlug}.json`),
        JSON.stringify(artistConcerts),
        'utf-8'
      )
    );
  }

  // 4. Write individual city files: dist/cities/{slug}.json
  for (const [citySlug, cityConcerts] of concertsByCity.entries()) {
    // Sort concerts by date ascending
    cityConcerts.sort((a, b) => a.date.localeCompare(b.date));
    writePromises.push(
      fs.writeFile(
        path.join(citiesDir, `${citySlug}.json`),
        JSON.stringify(cityConcerts),
        'utf-8'
      )
    );
  }

  // 4.5. Write additive paginated files under dist/concerts/page-{n}.json
  const concertsDir = path.join(outputDir, 'concerts');
  await fs.mkdir(concertsDir, { recursive: true });

  const pageCount = Math.ceil(concerts.length / CONCERTS_PAGE_SIZE);
  const keepPageFiles = new Set<string>();

  for (let i = 0; i < pageCount; i++) {
    const slice = concerts.slice(i * CONCERTS_PAGE_SIZE, (i + 1) * CONCERTS_PAGE_SIZE);
    const fileName = `page-${i + 1}.json`;
    keepPageFiles.add(fileName);
    writePromises.push(
      fs.writeFile(
        path.join(concertsDir, fileName),
        JSON.stringify(slice),
        'utf-8'
      )
    );
  }

  // Prune orphan page files in dist/concerts/ -- matched strictly against the
  // page-N.json pattern (not just "any .json") so this can never reach out and
  // delete an unrelated file some other future writer drops in this directory.
  const PAGE_FILE_PATTERN = /^page-\d+\.json$/;
  try {
    const existingFiles = await fs.readdir(concertsDir);
    for (const file of existingFiles) {
      if (PAGE_FILE_PATTERN.test(file) && !keepPageFiles.has(file)) {
        writePromises.push(fs.rm(path.join(concertsDir, file), { force: true }));
      }
    }
  } catch (err: any) {
    // fine if directory didn't exist or readdir failed
  }

  await Promise.all(writePromises);

  // 5. Create index metadata: dist/index.json
  const indexData: PublishIndex = {
    schemaVersion: CONCERT_SCHEMA_VERSION,
    lastRun: new Date().toISOString(),
    stats: {
      totalConcerts: concerts.length,
      uniqueArtists: uniqueArtists.size,
      uniqueCities: uniqueCities.size,
      pageCount,
      pageSize: CONCERTS_PAGE_SIZE
    },
    artists: sortedArtists,
    cities: sortedCities
  };

  await fs.writeFile(
    path.join(outputDir, 'index.json'),
    JSON.stringify(indexData),
    'utf-8'
  );

  // Ship the human-facing status dashboard as the site root (index.html). It reads
  // status.json / index.json / concerts.json client-side, so it needs no build step
  // -- just copy the static file in. Best-effort: a missing source file must never
  // fail a publish (e.g. a checkout that didn't include public/).
  try {
    const dashboardSrc = path.join(process.cwd(), 'public', 'dashboard.html');
    await fs.copyFile(dashboardSrc, path.join(outputDir, 'index.html'));
  } catch (err: any) {
    console.warn(`[Publisher] Skipped dashboard copy: ${err.message}`);
  }

  console.log(`[Publisher] Successfully published static API into: ${outputDir}`);
  console.log(`[Publisher] Total concerts: ${concerts.length}`);
  console.log(`[Publisher] Unique artists: ${uniqueArtists.size}`);
  console.log(`[Publisher] Unique cities: ${uniqueCities.size}`);
}
