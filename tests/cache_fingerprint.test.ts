import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hashScraperCacheInput, type VenueCache } from '../src/engine/cache.js';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const PAGE = `
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"MusicEvent","name":"JSON-LD Artist","startDate":"2027-01-03","location":{"name":"JSON-LD Hall","address":{"addressLocality":"Paris","addressCountry":"FR"}}}
  </script>
  <div class="old-event"><b>Old Artist</b><time>2027-01-01</time></div>
  <div class="new-event"><b>New Artist</b><time>2027-01-02</time></div>`;

function staticConfig(url: string, eventBlock = '.old-event'): ScraperConfig {
  return {
    id: 'fingerprint-source',
    domain: 'fingerprint.test',
    url,
    type: 'static_selectors',
    maxRetries: 0,
    selectors: {
      eventBlock,
      artist: 'b',
      date: 'time',
      venueNameFallback: 'Fixture Hall',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };
}

function cacheFrom(result: Awaited<ReturnType<typeof runScraper>>): VenueCache {
  assert.ok(result.contentHash);
  assert.ok(result.cacheFingerprint);
  return {
    etag: result.etag,
    lastModified: result.lastModified,
    contentHash: result.contentHash,
    cacheFingerprint: result.cacheFingerprint,
    scrapedAt: result.scrapedAt,
    concerts: result.concerts
  };
}

test('conditional cache reuse is bound to the executed config and parser implementation', async (t) => {
  const requests: Array<{ path: string; ifNoneMatch?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url || '', ifNoneMatch: request.headers['if-none-match'] });
    if (request.url === '/fail') {
      response.writeHead(503);
      response.end('temporarily unavailable');
      return;
    }
    if (request.headers['if-none-match'] === '"v1"') {
      response.writeHead(304, { ETag: '"v1"' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html', ETag: '"v1"' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://localhost:${address.port}/events`;

  const originalConfig = staticConfig(url);
  const first = await runScraper(originalConfig);
  assert.equal(first.success, true, first.error);
  assert.equal(first.concerts[0].artist, 'Old Artist');
  const cache = cacheFrom(first);

  const same = await runScraper(originalConfig, cache);
  assert.equal(same.success, true, same.error);
  assert.equal(same.notModified, true);
  assert.deepEqual(same.concerts, cache.concerts);
  assert.equal(requests.at(-1)?.ifNoneMatch, '"v1"', 'same fingerprint may make a conditional request');

  const changedSelectors = await runScraper(staticConfig(url, '.new-event'), cache);
  assert.equal(changedSelectors.success, true, changedSelectors.error);
  assert.equal(changedSelectors.concerts[0].artist, 'New Artist');
  assert.equal(requests.at(-1)?.ifNoneMatch, undefined, 'changed selectors must force one ordinary GET');

  const changedType: ScraperConfig = {
    ...originalConfig,
    type: 'jsonld'
  };
  const changedTypeResult = await runScraper(changedType, cache);
  assert.equal(changedTypeResult.success, true, changedTypeResult.error);
  assert.equal(changedTypeResult.concerts[0].artist, 'JSON-LD Artist');
  assert.equal(requests.at(-1)?.ifNoneMatch, undefined, 'changed scraper type must force one ordinary GET');

  const { cacheFingerprint: _, ...legacyCache } = cache;
  const legacyResult = await runScraper(originalConfig, legacyCache);
  assert.equal(legacyResult.success, true, legacyResult.error);
  assert.equal(legacyResult.concerts[0].artist, 'Old Artist');
  assert.ok(legacyResult.cacheFingerprint, 'the ordinary GET upgrades a legacy cache entry');
  assert.equal(requests.at(-1)?.ifNoneMatch, undefined, 'legacy cache must be refreshed once before conditional reuse');

  const snapshot = structuredClone(cache);
  const failed = await runScraper({ ...originalConfig, url: `http://localhost:${address.port}/fail` }, cache);
  assert.equal(failed.success, false);
  assert.deepEqual(cache, snapshot, 'a failed refresh must not mutate or discard the last-good cache entry');
});

test('custom implementation bytes are part of the cache fingerprint', () => {
  const config = staticConfig('https://fingerprint.test/events');
  assert.notEqual(
    hashScraperCacheInput({ ...config, type: 'custom_js' }, 'export const version = 1;'),
    hashScraperCacheInput({ ...config, type: 'custom_js' }, 'export const version = 2;')
  );
});

test('fingerprinting rejects an unvalidated custom ID before reading a module or fetching', async () => {
  const result = await runScraper({
    ...staticConfig('https://fingerprint.test/events'),
    type: 'custom_js', id: '../runner'
  });
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /Refusing to read custom module for unsafe scraper id/);
});
