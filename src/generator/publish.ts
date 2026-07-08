import * as fs from 'fs/promises';
import * as path from 'path';
import { Concert } from '../schemas/concert.js';
import { slugify, parseSpotifyArtistId } from '../pipeline/process.js';

export interface PublishStats {
  totalConcerts: number;
  uniqueArtists: number;
  uniqueCities: number;
}

export interface PublishIndex {
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
    }
    bySlug.set(slug, entry);
  }

  const catalog = Array.from(bySlug.values()).sort((x, y) => x.name.localeCompare(y.name));
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'artists.json'), JSON.stringify(catalog), 'utf-8');
  console.log(`[Publisher] Published artist catalog: ${catalog.length} artists -> dist/artists.json`);
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

  // 1. Group concerts by artist and city
  const concertsByArtist = new Map<string, Concert[]>();
  const concertsByCity = new Map<string, Concert[]>();
  const uniqueArtists = new Set<string>();
  const uniqueCities = new Set<string>();

  for (const concert of concerts) {
    uniqueArtists.add(concert.artist);
    uniqueCities.add(concert.city);

    const artistSlug = slugify(concert.artist);
    if (!concertsByArtist.has(artistSlug)) {
      concertsByArtist.set(artistSlug, []);
    }
    concertsByArtist.get(artistSlug)!.push(concert);

    const citySlug = slugify(concert.city);
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

  await Promise.all(writePromises);

  // 5. Create index metadata: dist/index.json
  const indexData: PublishIndex = {
    lastRun: new Date().toISOString(),
    stats: {
      totalConcerts: concerts.length,
      uniqueArtists: uniqueArtists.size,
      uniqueCities: uniqueCities.size
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
