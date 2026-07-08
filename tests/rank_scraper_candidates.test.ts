import test from 'node:test';
import assert from 'node:assert';
import { rankCandidates } from '../src/scripts/rank_scraper_candidates.js';

function fakeFetch(body: any): typeof fetch {
  return (async () => ({ ok: true, status: 200, json: async () => body })) as any;
}

test('rankCandidates - only includes artists that are targets, uncovered, and have a website', () => {
  const artists = [
    { name: 'Has Everything', website: 'https://a.example' },
    { name: 'Already Covered', website: 'https://b.example' },
    { name: 'No Website', website: null },
    { name: 'Not A Target', website: 'https://c.example' }
  ];
  const targetSet = new Set(['has everything', 'already covered', 'no website']);
  const coveredSet = new Set(['already covered']);

  return rankCandidates(artists, targetSet, coveredSet, undefined).then((result) => {
    assert.deepStrictEqual(result.map((c) => c.name), ['Has Everything']);
  });
});

test('rankCandidates - prefers already-collected popularity over a fresh Last.fm call', async () => {
  const artists = [{ name: 'Muse', website: 'https://muse.mu', popularity: { listeners: 999, playcount: 1 } }];
  const targetSet = new Set(['muse']);
  let called = false;
  const fetchFn: typeof fetch = (async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } as any; }) as any;

  const result = await rankCandidates(artists, targetSet, new Set(), 'fake-key', fetchFn);
  assert.strictEqual(result[0].listeners, 999);
  assert.strictEqual(called, false, 'must not hit Last.fm when popularity is already known');
});

test('rankCandidates - falls back to a live Last.fm lookup when popularity is missing and a key is provided', async () => {
  const artists = [{ name: 'Muse', website: 'https://muse.mu' }];
  const targetSet = new Set(['muse']);
  const fetchFn = fakeFetch({ artist: { name: 'Muse', stats: { listeners: '4500000', playcount: '900000000' } } });

  const result = await rankCandidates(artists, targetSet, new Set(), 'fake-key', fetchFn);
  assert.strictEqual(result[0].listeners, 4500000);
});

test('rankCandidates - without a key and no stored popularity, reports the artist unranked (not dropped)', async () => {
  const artists = [{ name: 'Muse', website: 'https://muse.mu' }];
  const targetSet = new Set(['muse']);

  const result = await rankCandidates(artists, targetSet, new Set(), undefined);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].listeners, null);
});

test('rankCandidates - sorts confidently-ranked artists by listeners desc, unranked ones after (alphabetical)', async () => {
  const artists = [
    { name: 'Zebra Band', website: 'https://z.example', popularity: { listeners: 100, playcount: 1 } },
    { name: 'Alpha Band', website: 'https://a.example' }, // no popularity, no key -> unranked
    { name: 'Big Band', website: 'https://b.example', popularity: { listeners: 5000, playcount: 1 } },
    { name: 'Zeta Band', website: 'https://zz.example' } // also unranked
  ];
  const targetSet = new Set(['zebra band', 'alpha band', 'big band', 'zeta band']);

  const result = await rankCandidates(artists, targetSet, new Set(), undefined);
  assert.deepStrictEqual(result.map((c) => c.name), ['Big Band', 'Zebra Band', 'Alpha Band', 'Zeta Band']);
});
