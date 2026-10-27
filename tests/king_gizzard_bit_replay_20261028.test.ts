import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import axios from 'axios';
import { fetchBandsintownConcerts } from '../src/engine/bandsintown.js';
import { processConcerts } from '../src/pipeline/process.js';
import { PRODUCTION_ARTIST_DB_DIR, loadApprovedArtists } from '../src/pipeline/artistDb.js';
import { publishConcerts } from '../src/generator/publish.js';
import type { Concert } from '../src/schemas/concert.js';

test('fresh one-artist normal BIT capture replays through real collector, real DB and isolated publisher with five explicit aggregator targets', async t => {
  const captured = JSON.parse(await readFile('tests/fixtures/official-remaining-20261028/king-bit-runtime.json', 'utf8'));
  assert.equal(captured.scope.maxPerRun, 1); assert.equal(captured.scope.initialCacheEntries, 0);
  assert.equal(captured.health.counts.attempted, 1); assert.equal(captured.health.counts.succeeded, 1);
  assert.equal(captured.health.counts.cacheFallbacks, 0); assert.equal(captured.independentOfficial, false);
  let calls = 0;
  t.mock.method(axios, 'get', async (url: string) => {
    assert.equal(url, captured.native[0].endpoint); calls++;
    return { status: 200, data: captured.native[0].data, headers: {} };
  });
  const raw = await fetchBandsintownConcerts(['King Gizzard & The Lizard Wizard'], { cache: {}, maxPerRun: 1, now: () => new Date(captured.startedAt) });
  assert.equal(calls, 1);
  assert.deepEqual(raw.map(r => [r.artist,r.date,r.city,r.venue,r.country]), captured.raw.map((r: Concert) => [r.artist,r.date,r.city,r.venue,r.country]));
  assert.equal(raw.length, 11);
  const processed = await processConcerts([...raw, ...raw], PRODUCTION_ARTIST_DB_DIR, captured.startedAt);
  assert.equal(processed.length, 11);
  const dir = await mkdtemp(join(tmpdir(), 'king-bit-publish-'));
  try {
    await publishConcerts(processed, dir, await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR));
    const published = JSON.parse(await readFile(join(dir, 'concerts.json'), 'utf8')) as Concert[];
    for (const [date,country] of [['2027-06-09','FR'],['2027-06-11','IT'],['2027-06-20','GB'],['2027-06-22','GB'],['2027-06-23','GB']]) {
      const hits = published.filter(r => r.date === date && r.country === country);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].artist, 'King Gizzard & the Lizard Wizard');
      assert.equal(hits[0].originalSource, 'bandsintown.com');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
