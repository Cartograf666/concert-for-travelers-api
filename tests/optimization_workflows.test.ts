import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name: string) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('publication has one normalization pass and no venue-only no-op gate', async () => {
  const source = await read('src/run.ts');
  assert.equal((source.match(/await processConcerts\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /shouldSkipPublish|enrichMissingArtistMetadata/);
  assert.match(source, /geocodeConcerts\(normalizedConcerts, \{ cache: geocodeCache, maxPerRun: 0 \}\)/);
  assert.match(source, /loadGeocodeCacheWithBackup\(geocodeCachePath, geocodeBackupPath\)/);
  assert.match(source, /saveGeocodeCache\(geocodeBackupPath, geocodeCache\)/);
  assert.doesNotMatch(source, /saveGeocodeCache\(geocodeCachePath/);
});

test('one scheduled artist producer precedes daily publication including failed runs', async () => {
  const daily = await read('.github/workflows/daily-scrape.yml');
  const artist = await read('.github/workflows/artist-scrape.yml');
  assert.match(daily, /workflows: \["Artist Tour-Page Scrape"\]/);
  assert.match(daily, /types: \[completed\]/);
  assert.doesNotMatch(daily, /^  schedule:/m);
  assert.match(artist, /^  schedule:/m);
  assert.match(daily, /head_repository.full_name == github.repository/);
  assert.match(daily, /head_branch == github.event.repository.default_branch/);
  assert.doesNotMatch(daily, /workflow_run.conclusion == 'success'/);
  assert.match(daily, /group: artist-db-write/);
});

test('geocode backfill exclusively writes the shared cache and preserves partial progress', async () => {
  const daily = await read('.github/workflows/daily-scrape.yml');
  const worker = await read('.github/workflows/geocode-backfill.yml');
  assert.match(daily, /path: reports\/geocode-cache.json/);
  assert.match(daily, /geocode-v1-/);
  assert.doesNotMatch(daily, /name: Save geocode/);
  assert.match(worker, /group: geocode-backfill/);
  assert.match(worker, /cancel-in-progress: false/);
  assert.match(worker, /if: always\(\) && hashFiles\('reports\/geocode-cache.json'\)/);
  assert.match(worker, /geocode-v1-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(worker, /npm run geocode-backfill/);
  assert.match(worker, /timeout-minutes: 45/);
  for (const workflow of [daily, worker]) {
    assert.match(workflow, /reports\/last-good-site\n\s+reports\/geocode-cache-backup.json/);
    assert.match(workflow, /publish-site-v2-/);
    assert.match(workflow, /Restore legacy Pages snapshot/);
  }
});

test('active JIT persists through the existing serialized delta commit workflow', async () => {
  const workflow = await read('.github/workflows/enrich-database.yml');
  assert.match(workflow, /group: artist-db-write/);
  const active = workflow.slice(workflow.indexOf('- name: Restore active concerts snapshot'), workflow.indexOf('# Tier-0:'));
  assert.match(active, /publish-site-/);
  assert.match(active, /npm run enrich-active/);
  assert.match(active, /GEMINI_API_KEYS:/);
  assert.match(active, /uses: \.\/\.github\/actions\/commit-artist-db-delta/);
  assert.match(active, /before-artists-dir: \$\{\{ env.ACTIVE_BEFORE \}\}/);
  assert.match(active, /after-artists-dir: \$\{\{ env.ACTIVE_AFTER \}\}/);
});
