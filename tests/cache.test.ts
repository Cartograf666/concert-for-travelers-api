import test from 'node:test';
import assert from 'node:assert';
import { shouldSkipPublish, isCacheStale, hashConcerts, ScrapeCache, MAX_CACHE_STALENESS_MS } from '../src/engine/cache.js';

const withCache = (id: string): ScrapeCache => ({
  [id]: { contentHash: 'h', scrapedAt: new Date().toISOString(), concerts: [{ artist: 'A', date: '2026-01-01' }] }
});

test('shouldSkipPublish: nothing changed, no TM, no uncached failure -> skip', () => {
  const results = [{ success: true, configId: 'a' }, { success: true, configId: 'b' }];
  assert.strictEqual(shouldSkipPublish(results, {}, 0, 0), true);
});

test('shouldSkipPublish: a changed venue -> do not skip', () => {
  const results = [{ success: true, configId: 'a' }];
  assert.strictEqual(shouldSkipPublish(results, {}, 1, 0), false);
});

test('shouldSkipPublish: Ticketmaster events present -> do not skip', () => {
  const results = [{ success: true, configId: 'a' }];
  assert.strictEqual(shouldSkipPublish(results, {}, 0, 5), false);
});

test('shouldSkipPublish: failure with NO cached events -> do not skip (venue would vanish)', () => {
  const results = [{ success: false, configId: 'a' }];
  assert.strictEqual(shouldSkipPublish(results, {}, 0, 0), false);
});

test('shouldSkipPublish: failure WITH cached events + nothing changed -> skip (falls back to cache)', () => {
  const results = [{ success: false, configId: 'a' }];
  assert.strictEqual(shouldSkipPublish(results, withCache('a'), 0, 0), true);
});

test('isCacheStale: fresh entry is not stale; missing/invalid entry is not flagged', () => {
  const now = Date.now();
  assert.strictEqual(isCacheStale({ contentHash: 'h', scrapedAt: new Date(now).toISOString(), concerts: [] }, now), false);
  assert.strictEqual(isCacheStale(undefined, now), false);
  assert.strictEqual(isCacheStale({ contentHash: 'h', scrapedAt: 'not-a-date', concerts: [] }, now), false);
});

test('isCacheStale: entry older than the staleness bound is stale', () => {
  const now = Date.now();
  const old = new Date(now - MAX_CACHE_STALENESS_MS - 1000).toISOString();
  assert.strictEqual(isCacheStale({ contentHash: 'h', scrapedAt: old, concerts: [] }, now), true);
});

test('hashConcerts is order-independent and content-sensitive', () => {
  const a = [{ artist: 'X', date: '2026-01-01' }, { artist: 'Y', date: '2026-02-02' }];
  const b = [{ artist: 'Y', date: '2026-02-02' }, { artist: 'X', date: '2026-01-01' }];
  assert.strictEqual(hashConcerts(a), hashConcerts(b), 'reordering does not change the hash');
  assert.notStrictEqual(hashConcerts(a), hashConcerts([{ artist: 'X', date: '2026-01-09' }]), 'different content changes it');
});
