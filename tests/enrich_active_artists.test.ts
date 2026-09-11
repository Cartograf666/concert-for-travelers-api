import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadActiveArtistNames, parseLimit, selectActiveArtistNames } from '../src/scripts/enrich_active_artists.js';
import { selectArtistsMissingMetadata } from '../src/pipeline/enrich.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');

test('active enrichment selects unique future/today artists and excludes expired concerts', () => {
  const names = selectActiveArtistNames([
    { artist: 'Artist A', date: '2026-09-11' },
    { artist: ' artist a ', date: '2026-10-01' },
    { artist: 'Artist B', date: '2026-09-10' },
    { artist: 'Artist C', date: 'not-a-date' },
    { artist: 'Artist Invalid', date: '2026-02-31' },
    { artist: 'Artist D', date: '2026-12-01' }
  ], NOW);
  assert.deepEqual(names, ['Artist A', 'Artist D']);
});

test('active enrichment treats missing or malformed snapshots as an empty safe no-op', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'concert-snapshot-'));
  try {
    const bad = path.join(dir, 'bad.json');
    await fs.writeFile(bad, '{not-json', 'utf-8');
    assert.deepEqual(await loadActiveArtistNames(path.join(dir, 'missing.json'), NOW), []);
    assert.deepEqual(await loadActiveArtistNames(bad, NOW), []);
    assert.deepEqual(selectActiveArtistNames({ concerts: [] }, NOW), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('active enrichment accepts only a strict positive integer limit', () => {
  assert.equal(parseLimit(undefined), undefined);
  assert.equal(parseLimit('12'), 12);
  assert.throws(() => parseLimit('12artists'), /positive integer/);
  assert.throws(() => parseLimit('1.5'), /positive integer/);
  assert.throws(() => parseLimit('0'), /positive integer/);
});

test('active enrichment preserves existing JIT eligibility regardless of prior enrichment markers', () => {
  const selected = selectArtistsMissingMetadata(
    ['Partial', 'No Socials', 'Null Website', 'Already Enriched', 'Missing'],
    [
      { name: 'Partial', website: 'https://partial.example', socials: { spotify: 'https://spotify.example/partial' } },
      { name: 'No Socials', website: 'https://no-socials.example' },
      { name: 'Null Website', website: null, socials: {} },
      { name: 'Already Enriched', website: null, socials: {}, enrichedAt: '2026-01-01', sitesTriedAt: '2026-01-02' }
    ]
  );
  assert.deepEqual(selected, ['No Socials', 'Null Website', 'Already Enriched', 'Missing']);
});
