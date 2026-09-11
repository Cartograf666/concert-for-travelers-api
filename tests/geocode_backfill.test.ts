import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_BACKUP_CACHE_PATH, DEFAULT_CACHE_PATH, DEFAULT_CONCERTS_PATH, DEFAULT_LOOKUP_CAP, parseBackfillArgs, runGeocodeBackfill } from '../src/scripts/geocode_backfill.js';
import { geocodeCacheKey, loadGeocodeCacheWithBackup } from '../src/pipeline/geocode.js';

function concert(venue: string) {
  return { artist: 'The Cure', date: '2026-10-12', venue, city: 'Berlin', country: 'DE', originalSource: 'example.test', scrapedAt: '2026-01-01T00:00:00.000Z' };
}

test('backfill honors its cap and atomically checkpoints each resolved lookup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geocode-backfill-'));
  const concertsPath = path.join(dir, 'last-good-site', 'concerts.json');
  const cachePath = path.join(dir, 'reports', 'geocode-cache.json');
  const backupPath = path.join(dir, 'reports', 'geocode-cache-backup.json');
  await fs.mkdir(path.dirname(concertsPath), { recursive: true });
  await fs.writeFile(concertsPath, JSON.stringify([concert('A'), concert('B')]));
  let calls = 0;
  const result = await runGeocodeBackfill({ concertsPath, cachePath, backupPath, maxLookups: 1, delayMs: 0, geocodeFn: async () => { calls++; return { lat: 1, lng: 2 }; } });
  const cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  assert.equal(calls, 1);
  assert.equal(result.stats.skippedCapped, 1);
  assert.deepEqual(cache[geocodeCacheKey(concert('A'))].lat, 1);
  assert.equal(cache[geocodeCacheKey(concert('B'))], undefined);
});

test('backfill refuses malformed cache rather than overwriting it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geocode-backfill-'));
  const concertsPath = path.join(dir, 'concerts.json');
  const cachePath = path.join(dir, 'cache.json');
  const backupPath = path.join(dir, 'backup.json');
  await fs.writeFile(concertsPath, JSON.stringify([concert('A')]));
  await fs.writeFile(cachePath, '{broken');
  await assert.rejects(() => runGeocodeBackfill({ concertsPath, cachePath, backupPath, geocodeFn: async () => ({ lat: 1, lng: 2 }) }), /invalid geocode cache JSON/);
  assert.equal(await fs.readFile(cachePath, 'utf-8'), '{broken');
});

test('backfill CLI defaults target the workflow snapshot and bounded cache pass', () => {
  assert.deepEqual(parseBackfillArgs([]), {
    concertsPath: path.join('reports', 'last-good-site', 'concerts.json'),
    cachePath: path.join('reports', 'geocode-cache.json'),
    maxLookups: 100
  });
  assert.equal(DEFAULT_CONCERTS_PATH, path.join('reports', 'last-good-site', 'concerts.json'));
  assert.equal(DEFAULT_CACHE_PATH, path.join('reports', 'geocode-cache.json'));
  assert.equal(DEFAULT_BACKUP_CACHE_PATH, path.join('reports', 'geocode-cache-backup.json'));
  assert.equal(DEFAULT_LOOKUP_CAP, 100);
});

test('backup loader recovers original Unicode keys but rejects malformed primary before any overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geocode-backfill-'));
  const primaryPath = path.join(dir, 'primary.json');
  const backupPath = path.join(dir, 'backup.json');
  const key = 'ライブハウス|東京|jp';
  await fs.writeFile(backupPath, JSON.stringify({ [key]: { lat: 35, lng: 139, geocodedAt: '2026-01-01T00:00:00.000Z' } }));
  const recovered = await loadGeocodeCacheWithBackup(primaryPath, backupPath);
  assert.equal(recovered[key].lat, 35);
  await fs.writeFile(primaryPath, '{broken');
  await assert.rejects(() => loadGeocodeCacheWithBackup(primaryPath, backupPath), /invalid geocode cache JSON/);
  assert.equal(await fs.readFile(primaryPath, 'utf-8'), '{broken');
});
