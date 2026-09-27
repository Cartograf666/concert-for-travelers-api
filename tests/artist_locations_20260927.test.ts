import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import { filterArtistCacheForActiveConfigs } from '../src/engine/artist_cache.js';
import type { ScrapeCache } from '../src/engine/cache.js';
import type { ScraperConfig } from '../src/schemas/config.js';
import { scrape as scrapeInsomnium } from '../src/engine/custom/artist-insomnium.js';
import { scrape as scrapeBethHart } from '../src/engine/custom/artist-beth-hart.js';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');

test('artist adapters retain shows but reject unsafe ticket schemes', async () => {
  for (const [id, parser] of [['insomnium', scrapeInsomnium], ['beth-hart', scrapeBethHart]] as const) {
    const config = JSON.parse(await readFile(`scrapers/artists/artist-${id}.json`, 'utf8'));
    const html = (await readFile(path.join(FIXTURES, `artist-${id}-tour-20260927.html`), 'utf8'))
      .replace(/href="[^"]*"/g, 'href="javascript:alert(1)"');
    const events = await parser(config, html, '2026-09-27T00:00:00Z');
    assert.ok(events.length > 0);
    assert.ok(events.every(event => event.ticketUrl === undefined));
  }
});

async function scrapeFixture(configFile: string, fixtureFile: string) {
  const html = await readFile(path.join(FIXTURES, fixtureFile), 'utf8');
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = JSON.parse(await readFile(configFile, 'utf8')) as ScraperConfig;
    config.url = `http://localhost:${address.port}/tour`;
    return await runScraper(config);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('Insomnium keeps the 5 evidenced shows, separates venue/city/country, and excludes the VIP card', async () => {
  const result = await scrapeFixture(
    'scrapers/artists/artist-insomnium.json',
    'artist-insomnium-tour-20260927.html'
  );

  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 5);
  assert.deepEqual(
    result.concerts.map(({ venue, city, country }) => ({ venue, city, country })),
    [
      { venue: 'Kulttuuritalo', city: 'Helsinki', country: 'FI' },
      { venue: 'Tarkastamo', city: 'Oulu', country: 'FI' },
      { venue: 'Paradise Rock Club', city: 'Boston', country: 'US' },
      { venue: 'Theatre Beanfield', city: 'Montréal', country: 'CA' },
      { venue: 'Summer Breeze Open Air', city: 'Dinkelsbühl', country: 'DE' }
    ]
  );
});

test('Beth Hart splits explicit locations, maps postal states, and rejects an unknown country', async () => {
  const result = await scrapeFixture(
    'scrapers/artists/artist-beth-hart.json',
    'artist-beth-hart-tour-20260927.html'
  );

  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 4);
  assert.deepEqual(
    result.concerts.map(({ city, country }) => ({ city, country })),
    [
      { city: 'Denver', country: 'US' },
      { city: 'Helsinki', country: 'FI' },
      { city: 'Prague', country: 'CZ' },
      { city: 'Brezoi', country: 'RO' }
    ]
  );
});

test('recovered artist rows pass the unchanged whitelist and Concert schema', async () => {
  const [insomnium, bethHart] = await Promise.all([
    scrapeFixture('scrapers/artists/artist-insomnium.json', 'artist-insomnium-tour-20260927.html'),
    scrapeFixture('scrapers/artists/artist-beth-hart.json', 'artist-beth-hart-tour-20260927.html')
  ]);

  const processed = await processConcerts(
    [...insomnium.concerts, ...bethHart.concerts],
    path.join(FIXTURES, 'artist-location-approved-20260927.json'),
    '2026-09-27T00:00:00.000Z'
  );

  assert.equal(processed.length, 9);
  assert.ok(processed.every((concert) => concert.country.length === 2));
});

test('retired Insomnia misattribution is absent while canonical Insomnium and its cache remain active', async () => {
  const cache: ScrapeCache = {
    'artist-insomnium': {
      scrapedAt: '2026-09-27T09:40:24.265Z',
      contentHash: 'canonical',
      concerts: [{ artist: 'Insomnium', date: '2026-10-16' }]
    },
    'artist-insomnia': {
      scrapedAt: '2026-09-27T09:40:24.037Z',
      contentHash: 'misattributed',
      concerts: [{ artist: 'Insomnia', date: '2026-10-16' }]
    }
  };

  const filtered = await filterArtistCacheForActiveConfigs(
    cache,
    path.join(process.cwd(), 'scrapers', 'artists')
  );

  assert.deepEqual(Object.keys(filtered), ['artist-insomnium']);
  assert.equal(filtered['artist-insomnium'].concerts[0].artist, 'Insomnium');
});
