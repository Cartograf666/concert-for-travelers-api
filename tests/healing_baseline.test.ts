import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadVerificationBaselines } from '../src/healing/verify.js';

test('healing baselines use the exact cohort artifact, including colliding scraper ids', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'heal-baseline-'));
  try {
    await writeFile(join(dir, 'scrape-cache.json'), JSON.stringify({ shared: { concerts: [{ artist: 'Venue Artist' }] } }));
    await writeFile(join(dir, 'artist-scrape-cache.json'), JSON.stringify({ shared: { concerts: [{ artist: 'Tour Artist' }, { artist: 'Tour Artist' }] } }));
    assert.deepEqual((await loadVerificationBaselines(dir, 'venue')).get('shared'), [{ artist: 'Venue Artist' }]);
    assert.deepEqual((await loadVerificationBaselines(dir, 'artist')).get('shared'), [{ artist: 'Tour Artist' }, { artist: 'Tour Artist' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing artist cache never uses the available venue cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'heal-baseline-'));
  try {
    await writeFile(join(dir, 'scrape-cache.json'), JSON.stringify({ shared: { concerts: [{}] } }));
    assert.equal((await loadVerificationBaselines(dir, 'artist')).size, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
