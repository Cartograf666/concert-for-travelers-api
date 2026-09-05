/**
 * Reports generated scraper configs whose `city` selector is identical to their
 * `venue` selector.
 *
 * Such a config does not extract a city -- it extracts the whole event block a
 * second time, so the published record carries a "city" like
 * "Fortaleza (CE), Festival Porao do Rock ... Comprar Ingressos". This is how
 * 60+ junk entries reached dist/index.json's `cities` list, and how a Japanese
 * listing eventually produced a city slug long enough to break publish outright
 * (see MAX_SLUG_BYTES in src/pipeline/process.ts).
 *
 * New configs can no longer be generated this way (dropDuplicateCitySelector in
 * extract_tour_scrapers.ts), but the ones already on disk are left alone
 * deliberately: removing the selector drops those concerts entirely whenever
 * `cityNameFallback` is empty, which is a data trade-off for a human to make
 * rather than a migration to run blind. This script exists to make that
 * decision an informed one.
 *
 *   npm run audit-city-selectors
 *   npm run audit-city-selectors -- --json
 */
import * as fs from 'fs/promises';
import * as path from 'path';

const SCRAPER_DIRS = ['scrapers', path.join('scrapers', 'artists')];

interface Offender {
  file: string;
  id: string;
  domain: string;
  selector: string;
  cityNameFallback: string;
  /** With no fallback, dropping the duplicate selector drops the scraper's concerts too. */
  droppingLosesData: boolean;
}

export function findDuplicateCitySelector(config: any, file: string): Offender | null {
  const selectors = config?.selectors;
  if (!selectors || typeof selectors !== 'object') return null;
  const venue = typeof selectors.venue === 'string' ? selectors.venue.trim() : '';
  const city = typeof selectors.city === 'string' ? selectors.city.trim() : '';
  if (!venue || venue !== city) return null;
  const fallback = typeof selectors.cityNameFallback === 'string' ? selectors.cityNameFallback.trim() : '';
  return {
    file,
    id: String(config.id ?? path.basename(file, '.json')),
    domain: String(config.domain ?? ''),
    selector: venue,
    cityNameFallback: fallback,
    droppingLosesData: fallback.length === 0
  };
}

async function collect(): Promise<{ offenders: Offender[]; scanned: number }> {
  const offenders: Offender[] = [];
  let scanned = 0;

  for (const dir of SCRAPER_DIRS) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue; // directory not present in this checkout
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(dir, entry);
      let config: any;
      try {
        config = JSON.parse(await fs.readFile(file, 'utf-8'));
      } catch {
        continue; // a malformed config is a different audit's problem
      }
      scanned++;
      const offender = findDuplicateCitySelector(config, file);
      if (offender) offenders.push(offender);
    }
  }

  offenders.sort((a, b) => a.id.localeCompare(b.id));
  return { offenders, scanned };
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const { offenders, scanned } = await collect();

  if (asJson) {
    console.log(JSON.stringify({ scanned, offenders }, null, 2));
    return;
  }

  console.log(`[CitySelectors] Scanned ${scanned} scraper configs.`);
  if (offenders.length === 0) {
    console.log('[CitySelectors] No config reuses its venue selector as its city selector.');
    return;
  }

  const losing = offenders.filter((o) => o.droppingLosesData).length;
  console.log(`[CitySelectors] ${offenders.length} config(s) use the same selector for venue and city.`);
  console.log(`[CitySelectors]   ${offenders.length - losing} have a cityNameFallback -- safe to drop the selector.`);
  console.log(`[CitySelectors]   ${losing} have no fallback -- dropping the selector drops their concerts.`);
  console.log('');
  for (const o of offenders) {
    const note = o.droppingLosesData ? 'no fallback' : `fallback="${o.cityNameFallback}"`;
    console.log(`  ${o.id}  (${o.domain})  selector=${o.selector}  [${note}]`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('audit_duplicate_city_selectors.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
