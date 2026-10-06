import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runScraper } from '../src/engine/runner.js';
import { hashConcerts, type VenueCache } from '../src/engine/cache.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

test('explicit empty notice is required, visible, and never hides a returning concert', async (t) => {
  const pages: Record<string, string> = {
    '/empty': '<main><p>No shows <strong>currently announced!</strong></p></main>',
    '/changed': '<main><section class="new-calendar"></section></main>',
    '/script': '<script>const message="No shows currently announced!"</script><main></main>',
    '/hidden': '<main><p hidden>No shows currently announced!</p></main>',
    '/aria-hidden': '<main aria-hidden="true"><p>No shows currently announced!</p></main>',
    '/display': '<main style="display:none !important"><p>No shows currently announced!</p></main>',
    '/visibility': '<main style="visibility:hidden"><p>No shows currently announced!</p></main>',
    '/opacity': '<main style="opacity:0"><p>No shows currently announced!</p></main>',
    '/event': '<main><article><h2>The Cure</h2><time>2027-07-01</time></article></main>'
  };
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(pages[req.url ?? ''] ?? ''); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = ScraperConfigSchema.parse({
    id: 'explicit-empty-contract', domain: 'empty-contract.test', url: 'https://empty-contract.example/empty',
    type: 'static_selectors', allowEmpty: true, emptyScheduleText: 'No shows currently announced!',
    selectors: {eventBlock: 'article', artist: 'h2', date: 'time', venueNameFallback: 'Test Hall', cityNameFallback: 'London', countryNameFallback: 'GB'}
  });
  base.url = `http://127.0.0.1:${address.port}/empty`;
  const empty = await runScraper(base);
  assert.equal(empty.success, true);
  assert.equal(empty.reason, 'empty_schedule');
  for (const pathname of ['/changed', '/script', '/hidden', '/aria-hidden', '/display', '/visibility', '/opacity']) {
    const result = await runScraper({...base, url: new URL(pathname, base.url).href});
    assert.equal(result.success, false);
    assert.notEqual(result.reason, 'empty_schedule');
  }
  const returned = await runScraper({...base, url: new URL('/event', base.url).href});
  assert.equal(returned.success, true);
  assert.equal(returned.concerts.length, 1);
  assert.equal(returned.concerts[0].artist, 'The Cure');
});

test('nonempty to empty to returning shows keeps cache hashes and change signals consistent', async (t) => {
  const event = '<article><h2>The Cure</h2><time>2027-07-01</time></article>';
  let body = event;
  const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end(body); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const config = {
    id:'empty-hash-contract',domain:'empty-hash.test',url:`http://127.0.0.1:${address.port}/schedule`,
    type:'static_selectors' as const,allowEmpty:true,emptyScheduleText:'No shows currently announced!',
    selectors:{eventBlock:'article',artist:'h2',date:'time',venueNameFallback:'Hall',cityNameFallback:'London',countryNameFallback:'GB'}
  };
  const first = await runScraper(config);
  assert.equal(first.success,true);
  assert.ok(first.contentHash);
  const cached: VenueCache = {contentHash:first.contentHash,cacheFingerprint:first.cacheFingerprint,
    scrapedAt:first.scrapedAt,concerts:first.concerts};
  body = '<p>No shows currently announced!</p>';
  const empty = await runScraper(config,cached);
  assert.equal(empty.success,true);
  assert.equal(empty.contentHash,hashConcerts([]));
  assert.equal(empty.notModified,false);
  const emptyCache: VenueCache = {contentHash:empty.contentHash!,cacheFingerprint:empty.cacheFingerprint,
    scrapedAt:empty.scrapedAt,concerts:empty.concerts};
  const unchanged = await runScraper(config,emptyCache);
  assert.equal(unchanged.notModified,true);
  body = event;
  const returned = await runScraper(config,emptyCache);
  assert.equal(returned.contentHash,first.contentHash);
  assert.equal(returned.notModified,false);
  assert.equal(returned.concerts.length,1);
  body = '<div hidden>No shows currently announced!</div>';
  const snapshot = structuredClone(cached);
  const failed = await runScraper(config,cached);
  assert.equal(failed.success,false);
  assert.deepEqual(cached,snapshot,'failed empty verification leaves prior rows and timestamps untouched');
});
