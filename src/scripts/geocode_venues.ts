import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfigSchema } from '../schemas/config.js';
import { sleep } from '../engine/sleep.js';
import { createNominatimGeocodeFn, NOMINATIM_RATE_LIMIT_MS } from '../pipeline/geocode.js';

// Scheduled bulk geocoding is deliberately limited to four requests per minute;
// the shared transport supplies the identifying project User-Agent.
async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  // Uses the same HTTPS endpoint, identifying project User-Agent and bounded
  // timeout as the resumable venue backfill.
  const geocode = createNominatimGeocodeFn();

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
      const result = await geocode(query);
      if (!result) {
        console.warn(`[Geocode] ${config.id}: no result for "${query}".`);
        failed++;
      } else {
        raw.selectors.lat = result.lat;
        raw.selectors.lng = result.lng;
        await fs.writeFile(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        console.log(`[Geocode] ${config.id}: "${query}" -> ${result.lat}, ${result.lng}`);
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
