import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScraperSourceHealth,
  createArtistSourceHealthBundle,
  createUnknownSourceHealth,
  readArtistSourceHealthBundle,
  verifiedVenueCacheEntry
} from '../src/observability/source_health.js';
import type { VenueCache } from '../src/engine/cache.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const oldObservation: VenueCache = {
  contentHash: 'abc',
  scrapedAt: '2026-01-01T00:00:00.000Z',
  concerts: [{ artist: 'A', date: '2026-03-01' }]
};

test('source health - successful 304-style result advances verification without changing observation time', () => {
  const verified = verifiedVenueCacheEntry(oldObservation, { success: true }, '2026-02-01T00:00:00.000Z');
  assert.equal(verified.scrapedAt, oldObservation.scrapedAt);
  assert.equal(verified.verifiedAt, '2026-02-01T00:00:00.000Z');

  const afterFailure = verifiedVenueCacheEntry(verified, { success: false }, '2026-03-01T00:00:00.000Z');
  assert.equal(afterFailure.verifiedAt, '2026-02-01T00:00:00.000Z', 'failed attempt must not advance verification');
});

test('source health - legacy cache observation without verifiedAt remains unknown', () => {
  const report = buildScraperSourceHealth('venue', [{
    configId: 'legacy', success: false, concerts: [], reason: 'fetch_error'
  }], { legacy: oldObservation }, { generatedAt: '2026-02-01T00:00:00.000Z', revisitIntervalDays: 30 });

  assert.equal(report.state, 'unavailable');
  assert.equal(report.counts.cacheFallbacks, 1);
  assert.equal(report.counts.missing, 0, 'legacy verification is unknown, but the cache entry is present');
  assert.equal(report.freshness.unknown, 1);
  assert.equal(report.freshness.latestVerifiedAt, null);
});

test('source health - bundle reader accepts current reports and rejects malformed or mismatched cache input', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-health-reader-'));
  const reportPath = path.join(dir, 'artist-source-health.json');
  try {
    const valid = createArtistSourceHealthBundle('2026-02-01T00:00:00.000Z');
    await fs.writeFile(reportPath, JSON.stringify(valid));
    assert.deepStrictEqual(await readArtistSourceHealthBundle(dir), valid);

    const invalids = [
      { ...valid, schemaVersion: 2 },
      { ...valid, generatedAt: 'invalid' },
      { ...valid, sources: { ...valid.sources, artist: { ...valid.sources.artist, source: 'venue' } } },
      { ...valid, sources: { ...valid.sources, bandsintown: { ...valid.sources.bandsintown, state: 'great' } } },
      { ...valid, sources: { ...valid.sources, eventbrite: {
        ...valid.sources.eventbrite,
        freshness: { ...valid.sources.eventbrite.freshness, maxDays: -1 }
      } } },
      { ...valid, sources: { ...valid.sources, artist: {
        ...valid.sources.artist,
        issues: [{ reason: 'not_run', count: 1, action: 'unsafe action' }]
      } } }
    ];
    for (const invalid of invalids) {
      await fs.writeFile(reportPath, JSON.stringify(invalid));
      assert.equal(await readArtistSourceHealthBundle(dir), null);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('source health - zero targets and not configured are unknown, never healthy', () => {
  const noTargets = buildScraperSourceHealth('artist', [], {}, { generatedAt: '2026-02-01T00:00:00.000Z' });
  const notConfigured = createUnknownSourceHealth('ticketmaster', 'not_configured', '2026-02-01T00:00:00.000Z');
  assert.equal(noTargets.state, 'unknown');
  assert.equal(notConfigured.state, 'unknown');
  assert.equal(noTargets.completeness, 'unknown');
  assert.equal(notConfigured.issues[0].reason, 'not_configured');
});
