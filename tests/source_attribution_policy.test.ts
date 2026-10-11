import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApprovedMatcher, processConcerts } from '../src/pipeline/process.js';
import type { RawConcert } from '../src/schemas/concert.js';

const NOW = '2026-10-10T10:54:07.538Z';
const artists = [
  { name: 'Natalie Tenenbaum', aliases: ['Natalie Tenenbaum Piano'], mbid: '11111111-1111-4111-8111-111111111111' },
  { name: 'Siglo XX', aliases: ['Siglo XX (banda)'], mbid: '3e67e025-bfc4-44f0-b490-fade1f997d73' },
  { name: 'Giovanni Viotti' }, { name: 'Colombia' }, { name: 'Rize' }
];
const native: RawConcert = {
  artist: 'Natalie Tenenbaum', date: '2027-01-16', startTime: '16:00',
  venue: 'Palacio de la Proclamación', city: 'Cartagena', country: 'CO',
  sourceEventUrl: 'https://cartagenamusicfestival.com/show-item/la-intuicion-del-siglo-xx/?lang=en',
  originalSource: 'cartagenamusicfestival.com', scrapedAt: NOW
};
async function withDb(fn: (db: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'source-attribution-'));
  try {
    const db = path.join(dir, 'artists.json');
    await writeFile(db, JSON.stringify(artists));
    await fn(db);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('exact invocation uses full canonical/approved alias before title cleanup; default stays permissive', () => {
  const match = buildApprovedMatcher(artists);
  for (const name of ['Natalie Tenenbaum', '  NATALIE TENENBAUM  ', 'Natalie Tenenbaum Piano']) {
    assert.equal(match(name, 'exact')?.name, 'Natalie Tenenbaum');
  }
  for (const [input, canonical] of [
    ['Natalie Tenenbaum (live)', 'Natalie Tenenbaum'],
    ['Natalie Tenenbaum - Tour', 'Natalie Tenenbaum'],
    ['Natalie Tenenbaum - A New Programme', 'Natalie Tenenbaum'],
    ['Natalie Tenenbam', 'Natalie Tenenbaum'],
    ['La Intuición del siglo XX', 'Siglo XX'],
    ['Giovanni Bietti', 'Giovanni Viotti'],
    ['Filarmónica Joven de Colombia', 'Colombia'],
    ['RIZA', 'Rize']
  ]) {
    assert.equal(match(input)?.name, canonical, `Default remains unchanged for ${input}`);
    assert.equal(match(input, 'exact'), null, `Full native identity is required for ${input}`);
    assert.equal(match(input)?.name, canonical, 'Exact call must not change subsequent default calls');
  }
  assert.equal(match('Natalie  Tenenbaum', 'exact'), null, 'No whitespace collapsing inside native names');
  assert.equal(buildApprovedMatcher(['André Lislevand'])('Andre Lislevand', 'exact'), null, 'No accent folding');
});

test('exact mode reuses ambiguous-alias rejection and canonical-name priority', () => {
  const canonical = { name: 'Shared Name', mbid: 'canonical' };
  const a = { name: 'First Artist', aliases: ['Shared Name', 'Ambiguous Alias', 'Unique Alias'], mbid: 'first' };
  const b = { name: 'Second Artist', aliases: ['Ambiguous Alias'], mbid: 'second' };
  for (const order of [[a,b,canonical], [canonical,b,a]]) {
    const match = buildApprovedMatcher(order);
    assert.equal(match('SHARED NAME', 'exact')?.mbid, canonical.mbid);
    assert.equal(match('Ambiguous Alias', 'exact'), null);
    assert.equal(match('Unique Alias', 'exact')?.mbid, a.mbid);
    assert.equal(match('First Artist', 'exact')?.mbid, a.mbid);
  }
  assert.equal(buildApprovedMatcher(['Cover Band'])('Cover Band', 'exact')?.name, 'Cover Band');
});

test('Cartagena quarantines legacy titles and unsupported performers without mutating raw evidence', async () => {
  await withDb(async db => {
    const raw = ['La Intuición del siglo XX', 'Giovanni Bietti', 'Filarmónica Joven de Colombia', 'RIZA']
      .map(artist => ({ ...native, artist, sourceEventUrl: undefined,
        ticketUrl: 'https://cartagenamusicfestival.com/tc-events/la-intuicion-del-siglo-xx/?lang=en' }));
    const before = structuredClone(raw);
    let dropped = -1;
    assert.deepEqual(await processConcerts(raw, db, NOW, undefined, r => { dropped = r.dropped.notApproved; }), []);
    assert.equal(dropped, raw.length);
    assert.deepEqual(raw, before);
    for (const originalSource of [' CARTAGENAMUSICFESTIVAL.COM ', 'www.cartagenamusicfestival.com']) {
      assert.deepEqual(await processConcerts(raw.map(row => ({...row, originalSource})), db, NOW), []);
    }
  });
});

test('Cartagena exact canonical/alias metadata passes and unrelated sources retain fuzzy/substring matching', async () => {
  await withDb(async db => {
    const exact = [native, { ...native, artist: 'NATALIE TENENBAUM PIANO', date: '2027-01-17' }];
    const result = await processConcerts(exact, db, NOW);
    assert.equal(result.length, 2);
    for (const row of result) {
      assert.equal(row.artist, artists[0].name);
      assert.equal(row.mbid, artists[0].mbid);
      assert.equal(row.startTime, '16:00');
      assert.equal(row.venue, native.venue);
      assert.equal(row.originalSource, native.originalSource);
      assert.equal(native.sourceEventUrl, 'https://cartagenamusicfestival.com/show-item/la-intuicion-del-siglo-xx/?lang=en');
    }
    const controls = [
      { ...native, artist: 'Natalie Tenenbam', originalSource: 'venue.example', date: '2027-01-18' },
      { ...native, artist: 'La Intuición del siglo XX', originalSource: 'venue.example', date: '2027-01-19' },
      { ...native, artist: 'RIZA', originalSource: 'cartagenamusicfestival.com.evil.example', date: '2027-01-20' },
      { ...native, artist: 'Giovanni Bietti', originalSource: 'fakecartagenamusicfestival.com', date: '2027-01-21' }
    ];
    const unchanged = await processConcerts(controls, db, NOW);
    assert.deepEqual(unchanged.map(row => row.artist), ['Natalie Tenenbaum', 'Siglo XX', 'Rize', 'Giovanni Viotti']);
    const unsupported = { ...native, artist: 'La Intuición del siglo XX', date: '2027-01-22' };
    for (const order of [[unsupported, ...controls], [...controls, unsupported]]) {
      assert.deepEqual(await processConcerts(order, db, NOW), unchanged, 'One source quarantine must preserve other sources');
    }
  });
});
