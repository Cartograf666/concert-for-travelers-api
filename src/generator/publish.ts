import * as fs from 'fs/promises';
import * as path from 'path';
import { Concert } from '../schemas/concert.js';
import { slugify } from '../pipeline/process.js';

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

  // 2. Write master concert list: dist/concerts.json
  await fs.writeFile(
    path.join(outputDir, 'concerts.json'),
    JSON.stringify(concerts, null, 2),
    'utf-8'
  );

  // 3. Write individual artist files: dist/artists/{slug}.json
  for (const [artistSlug, artistConcerts] of concertsByArtist.entries()) {
    // Sort concerts by date ascending
    artistConcerts.sort((a, b) => a.date.localeCompare(b.date));
    await fs.writeFile(
      path.join(artistsDir, `${artistSlug}.json`),
      JSON.stringify(artistConcerts, null, 2),
      'utf-8'
    );
  }

  // 4. Write individual city files: dist/cities/{slug}.json
  for (const [citySlug, cityConcerts] of concertsByCity.entries()) {
    // Sort concerts by date ascending
    cityConcerts.sort((a, b) => a.date.localeCompare(b.date));
    await fs.writeFile(
      path.join(citiesDir, `${citySlug}.json`),
      JSON.stringify(cityConcerts, null, 2),
      'utf-8'
    );
  }

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
    JSON.stringify(indexData, null, 2),
    'utf-8'
  );

  console.log(`[Publisher] Successfully published static API into: ${outputDir}`);
  console.log(`[Publisher] Total concerts: ${concerts.length}`);
  console.log(`[Publisher] Unique artists: ${uniqueArtists.size}`);
  console.log(`[Publisher] Unique cities: ${uniqueCities.size}`);
}
