import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  buildRunManifest, failureLogMatchesManifest, readRunManifest, sourceHealth, writeRunManifest
} from '../src/observability/run_manifest.js';

const at = '2026-09-11T00:00:00.000Z';
const results = [
  { configId: 'venue-ok', success: true, concerts: [], scrapedAt: at, notModified: true },
  { configId: 'venue-bad', success: false, concerts: [], scrapedAt: at, reason: 'fetch_error' as const, error: 'timeout' }
];
const hashes = { 'venue-ok': 'a'.repeat(64), 'venue-bad': 'b'.repeat(64) };

test('run manifest records a complete cohort result with repo-relative paths', () => {
  const venue = buildRunManifest('venue', results, { changed: 0, configHashes: hashes, staleIds: ['venue-bad'], generatedAt: at });
  const artist = buildRunManifest('artist', results, { changed: 0, configHashes: hashes, generatedAt: at });

  assert.equal(venue.schemaVersion, 1);
  assert.equal(venue.complete, true);
  assert.equal(venue.outcomes[0].status, 'succeeded');
  assert.equal(venue.outcomes[0].configHash, hashes['venue-ok']);
  assert.deepEqual(venue.scrapers, { total: 2, succeeded: 1, failed: 1, changed: 0, unchanged: 1, staleIds: ['venue-bad'] });
  assert.equal(venue.failures[0].configPath, 'scrapers/venue-bad.json');
  assert.equal(artist.failures[0].configPath, 'scrapers/artists/venue-bad.json');
  assert.equal(failureLogMatchesManifest([{
    id: 'venue-bad', configPath: 'scrapers/venue-bad.json', reason: 'fetch_error', error: 'timeout', htmlSample: '<html>'
  }], venue), true);
  assert.equal(failureLogMatchesManifest([], venue), false);
});

test('run manifest builder refuses to emit outcomes without a config hash', () => {
  assert.throws(() => buildRunManifest('venue', results, { changed: 0, configHashes: {}, generatedAt: at }), /config hash/);
});

test('run manifest reader is best-effort and source health is compact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'concert-run-manifest-'));
  try {
    const manifest = buildRunManifest('artist', results, { changed: 0, configHashes: hashes, generatedAt: at });
    await writeRunManifest(dir, manifest);
    const restored = await readRunManifest(dir, 'artist');
    assert.equal(restored?.generatedAt, at);
    assert.deepEqual(sourceHealth(restored), {
      schemaVersion: 1, generatedAt: at, cohort: 'artist', total: 2,
      succeeded: 1, failed: 1, changed: 0, unchanged: 1, stale: 0
    });
    assert.equal(await readRunManifest(dir, 'venue'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('run manifest reader safely rejects incomplete or incompatible v1 data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'concert-run-manifest-invalid-'));
  try {
    const valid = buildRunManifest('venue', results, { changed: 0, configHashes: hashes, generatedAt: at });
    const invalids = [
      { ...valid, schemaVersion: 2 },
      { ...valid, complete: false },
      { ...valid, scrapers: { ...valid.scrapers, staleIds: undefined } },
      { ...valid, scrapers: { ...valid.scrapers, changed: undefined } },
      { ...valid, scrapers: { ...valid.scrapers, unchanged: 99 } },
      { ...valid, outcomes: valid.outcomes.map((outcome) => ({ ...outcome, configHash: undefined })) },
      { ...valid, run: { id: valid.run.id, attempt: 0 } }
    ];
    for (const invalid of invalids) {
      await fs.writeFile(path.join(dir, 'venue-run-manifest.json'), JSON.stringify(invalid));
      assert.equal(await readRunManifest(dir, 'venue'), null);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
