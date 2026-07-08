import test from 'node:test';
import assert from 'node:assert';
import { applyResolvedBatch, BackfillArtistEntry } from '../src/scripts/backfill_mbid.js';
import { Resolved } from '../src/scripts/enrich_wikidata_bulk.js';

function emptySocials() {
  return { spotify: null, instagram: null, facebook: null, youtube: null, telegram: null, vk: null };
}

test('applyResolvedBatch - fills mbid only for a confident, non-ambiguous, mbid-bearing resolution and sets tried marker', () => {
  const batch: BackfillArtistEntry[] = [
    { name: 'Muse', website: null },
    { name: 'Ambiguous Band', website: null },
    { name: 'Resolved But No Mbid', website: null },
    { name: 'No Match At All', website: null }
  ];

  const resolved = new Map<string, Resolved | 'ambiguous'>([
    ['muse', { item: 'wd:Q1', website: null, socials: emptySocials(), mbid: '11111111-2222-3333-4444-555555555555' }],
    ['ambiguous band', 'ambiguous'],
    ['resolved but no mbid', { item: 'wd:Q2', website: 'https://example.com', socials: emptySocials(), mbid: null }]
    // 'no match at all' deliberately absent from the map
  ]);

  const stamp = '2026-07-08T12:00:00.000Z';
  const hits = applyResolvedBatch(batch, resolved, stamp);

  assert.strictEqual(hits, 1, 'only Muse is a confident, mbid-bearing match');
  assert.strictEqual(batch[0].mbid, '11111111-2222-3333-4444-555555555555');
  assert.strictEqual(batch[1].mbid, undefined, 'ambiguous resolution must not set mbid');
  assert.strictEqual(batch[2].mbid, undefined, 'a resolution with no mbid (even with other data) must not set mbid');
  assert.strictEqual(batch[3].mbid, undefined, 'no resolution at all must not set mbid');

  // Verify that all attempted artists are marked as tried
  for (const entry of batch) {
    assert.strictEqual(entry.mbidBackfillTriedAt, stamp, `${entry.name} should be marked as tried`);
  }
});

test('applyResolvedBatch - matches case/diacritic-insensitively via normName, not raw name', () => {
  const batch: BackfillArtistEntry[] = [{ name: 'RAMMSTEIN', website: null }];
  const resolved = new Map<string, Resolved | 'ambiguous'>([
    ['rammstein', { item: 'wd:Q3', website: null, socials: emptySocials(), mbid: 'abc-123' }]
  ]);

  const hits = applyResolvedBatch(batch, resolved);
  assert.strictEqual(hits, 1);
  assert.strictEqual(batch[0].mbid, 'abc-123');
  assert.ok(batch[0].mbidBackfillTriedAt, 'should have mbidBackfillTriedAt set');
});

test('applyResolvedBatch - an empty batch/map yields zero hits, no throw', () => {
  assert.strictEqual(applyResolvedBatch([], new Map()), 0);
});

test('pending filter - previously-tried misses or matches are NOT re-selected by subsequent passes', () => {
  const artists: BackfillArtistEntry[] = [
    { name: 'Need Backfill', website: null }, // no mbid, no tried marker
    { name: 'Already Has Mbid', website: null, mbid: 'some-mbid' }, // has mbid, no tried marker
    { name: 'Already Tried Miss', website: null, mbidBackfillTriedAt: '2026-07-08T12:00:00.000Z' }, // no mbid, has tried marker
    { name: 'Already Tried Hit', website: null, mbid: 'another-mbid', mbidBackfillTriedAt: '2026-07-08T12:00:00.000Z' } // has mbid, has tried marker
  ];

  const pending = artists.filter((a) => !a.mbid && !a.mbidBackfillTriedAt);

  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].name, 'Need Backfill');
});
