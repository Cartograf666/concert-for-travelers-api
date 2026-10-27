/** Bounded opt-in live verification: three assigned public sources, no sweep/cache writes. */
import { writeFile } from 'node:fs/promises';
import { loadConfigs, runScraper, closeBrowser } from '../../../src/engine/runner.js';
import { processConcerts } from '../../../src/pipeline/process.js';
import { PRODUCTION_ARTIST_DB_DIR } from '../../../src/pipeline/artistDb.js';
const ids = ['artist-king-gizzard-radiant', 'artist-king-gizzard-sequoie', 'artist-king-gizzard-apollo'];
async function main() {
  const configs = (await loadConfigs('scrapers/artists')).filter(c => ids.includes(c.id));
  if (configs.length !== ids.length) throw new Error('Assigned source configs not discovered');
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    for (const c of configs) {
      const result = await runScraper(c);
      results.push({ configId: c.id, url: c.url, ...result });
      console.log(c.id, result.success, result.reason || '', result.concerts.length);
    }
    const raw = results.flatMap(r => r.concerts);
    const diagnostics: unknown[] = [];
    const processed = await processConcerts(raw, PRODUCTION_ARTIST_DB_DIR, startedAt, undefined, r => diagnostics.push(r));
    await writeFile('tests/fixtures/official-remaining-20261028/king-primary-live.json', JSON.stringify({ startedAt, completedAt: new Date().toISOString(), results, rawCount: raw.length, diagnostics, processed }, null, 2) + '\n');
    console.log('raw', raw.length, 'processed', processed.length);
  } finally { await closeBrowser(); }
}
void main();
