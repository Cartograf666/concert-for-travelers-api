import test from 'node:test';
import assert from 'node:assert';
import { applyResolvedBatch } from '../src/scripts/backfill_mbid.js';
import { ArtistEntry, Resolved } from '../src/scripts/enrich_wikidata_bulk.js';

function emptySocials() {
  return { spotify: null, instagram: null, facebook: null, youtube: null, telegram: null, vk: null };
}

test('applyResolvedBatch - fills mbid only for a confident, non-ambiguous, mbid-bearing resolution', () => {
  const batch: ArtistEntry[] = [
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

  const hits = applyResolvedBatch(batch, resolved);

  assert.strictEqual(hits, 1, 'only Muse is a confident, mbid-bearing match');
  assert.strictEqual(batch[0].mbid, '11111111-2222-3333-4444-555555555555');
  assert.strictEqual(batch[1].mbid, undefined, 'ambiguous resolution must not set mbid');
  assert.strictEqual(batch[2].mbid, undefined, 'a resolution with no mbid (even with other data) must not set mbid');
  assert.strictEqual(batch[3].mbid, undefined, 'no resolution at all must not set mbid');
});

test('applyResolvedBatch - matches case/diacritic-insensitively via normName, not raw name', () => {
  const batch: ArtistEntry[] = [{ name: 'RAMMSTEIN', website: null }];
  const resolved = new Map<string, Resolved | 'ambiguous'>([
    ['rammstein', { item: 'wd:Q3', website: null, socials: emptySocials(), mbid: 'abc-123' }]
  ]);

  const hits = applyResolvedBatch(batch, resolved);
  assert.strictEqual(hits, 1);
  assert.strictEqual(batch[0].mbid, 'abc-123');
});

test('applyResolvedBatch - an empty batch/map yields zero hits, no throw', () => {
  assert.strictEqual(applyResolvedBatch([], new Map()), 0);
});
