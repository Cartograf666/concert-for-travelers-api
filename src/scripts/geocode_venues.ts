import * as fs from 'fs/promises';
import * as path from 'path';
import getGeocoder from 'node-geocoder';
import { ScraperConfigSchema } from '../schemas/config.js';
import { sleep } from '../engine/sleep.js';

// Nominatim's usage policy requires a max of 1 request/second and an identifying
// contact (email query param or a descriptive User-Agent) for any bulk/automated use.
const NOMINATIM_RATE_LIMIT_MS = 1100;


async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const email = process.env.NOMINATIM_EMAIL;
  if (!email) {
    console.warn(
      '[Geocode] NOMINATIM_EMAIL is not set. Nominatim\'s usage policy asks for an ' +
      'identifying contact for automated use -- set it to a real address before running this at scale.'
    );
  }

  const geocoder = getGeocoder(email ? { provider: 'openstreetmap', email } : { provider: 'openstreetmap' });

  const files = (await fs.readdir(scrapersDir)).filter((f) => f.endsWith('.json'));
  let geocoded = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(scrapersDir, file);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const config = ScraperConfigSchema.parse(raw);

    if (!config.selectors) {
      console.log(`[Geocode] ${config.id}: no selectors, skipping.`);
      skipped++;
      continue;
    }
    if (config.selectors.lat !== undefined && config.selectors.lng !== undefined) {
      console.log(`[Geocode] ${config.id}: already has coordinates, skipping.`);
      skipped++;
      continue;
    }
    if (config.selectors.venue) {
      // Artist tour-page scraper: venue varies per row, a single fixed venue
      // coordinate would be wrong for most of its events. Not handled here --
      // per-row geocoding is a separate, larger enrichment feature.
      console.log(`[Geocode] ${config.id}: per-row venue selector (tour page), skipping.`);
      skipped++;
      continue;
    }

    const { venueNameFallback, cityNameFallback, countryNameFallback } = config.selectors;
    const query = `${venueNameFallback}, ${cityNameFallback}, ${countryNameFallback}`;

    try {
      const results = await geocoder.geocode(query);
      if (results.length === 0 || results[0].latitude === undefined || results[0].longitude === undefined) {
        console.warn(`[Geocode] ${config.id}: no result for "${query}".`);
        failed++;
      } else {
        const { latitude, longitude } = results[0];
        raw.selectors.lat = latitude;
        raw.selectors.lng = longitude;
        await fs.writeFile(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        console.log(`[Geocode] ${config.id}: "${query}" -> ${latitude}, ${longitude}`);
        geocoded++;
      }
    } catch (err: any) {
      console.warn(`[Geocode] ${config.id}: geocoding failed - ${err.message}`);
      failed++;
    }

    await sleep(NOMINATIM_RATE_LIMIT_MS);
  }

  console.log(`\n[Geocode] Done. Geocoded: ${geocoded}, skipped: ${skipped}, failed: ${failed}.`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
