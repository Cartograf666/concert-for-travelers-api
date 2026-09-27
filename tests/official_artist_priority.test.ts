import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildOfficialArtistContext, OFFICIAL_ARTIST_SOURCES } from '../src/engine/official_artist_sources.js';
import { loadConfigs, scraperCacheFingerprint } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScrapeCache } from '../src/engine/cache.js';
import type { ScraperConfig } from '../src/schemas/config.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';
import { verifiedVenueCacheEntry } from '../src/observability/source_health.js';

const NOW = '2026-09-28T12:00:00.000Z';
const CONFIG: ScraperConfig = {
  id: 'artist-hue-cry', domain: 'hueandcry.co.uk', url: 'https://hueandcry.co.uk/live/',
  type: 'custom_js', selectors: {
    eventBlock: 'p', date: 'strong', venueNameFallback: '', cityNameFallback: '', countryNameFallback: 'GB'
  }
};
const official = (overrides: Partial<Concert> = {}): Partial<Concert> => ({
  artist: 'Hue & Cry', date: '2026-11-12', venue: 'New Room', city: 'Glasgow', country: 'GB',
  originalSource: 'hueandcry.co.uk', scrapedAt: '2026-09-20T00:00:00.000Z',
  ...overrides
});
const ordinary = (overrides: Partial<Concert> = {}): Partial<Concert> => ({
  ...official({ venue: 'Old Hall', originalSource: 'aggregator.example', lat: 55.8, lng: -4.2,
    startTime: '20:00', lineup: ['Support'], ticketUrl: 'https://aggregator.example/ticket' }),
  ...overrides
});

async function fixture(config: ScraperConfig = CONFIG) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'official-artist-'));
  const configsDir = path.join(dir, 'configs');
  await mkdir(configsDir);
  await writeFile(path.join(configsDir, 'renamed.json'), JSON.stringify(config));
  const approved = path.join(dir, 'approved.json');
  await writeFile(approved, JSON.stringify([{ name: 'Hue & Cry' }, { name: 'Other Artist' }]));
  return { configsDir, approved, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function cacheFor(row: Partial<Concert>, fingerprint: string, verifiedAt = NOW): ScrapeCache {
  return { 'artist-hue-cry': {
    concerts: [row], contentHash: 'saved', scrapedAt: '2026-09-20T00:00:00.000Z',
    verifiedAt, cacheFingerprint: fingerprint
  } };
}

test('verified official whole row wins in either input order, despite richer aggregator and relocated venue', async () => {
  const f = await fixture();
  try {
    const fingerprint = await scraperCacheFingerprint(CONFIG);
    for (const rows of [[ordinary(), official()], [official(), ordinary()]]) {
      const context = await buildOfficialArtistContext(cacheFor(rows.find(r => r.originalSource === 'hueandcry.co.uk')!, fingerprint), f.configsDir, Date.parse(NOW));
      let diagnostics: ProcessingDiagnostics | undefined;
      const result = await processConcerts(rows, f.approved, NOW, undefined, report => { diagnostics = report; }, context);
      assert.equal(result.length, 1);
      assert.equal(result[0].venue, 'New Room');
      assert.equal(result[0].lat, undefined);
      assert.equal(result[0].lineup, undefined);
      assert.equal(diagnostics?.duplicatesMerged, 1);
      assert.equal(diagnostics?.sources['aggregator.example']?.duplicatesMerged, 1);
      assert.equal(diagnostics?.sources['hueandcry.co.uk']?.publishedCount, 1);
    }
  } finally { await f.cleanup(); }
});

test('copied official fields and flags on a different raw object do not inherit cache authority', async () => {
  const f = await fixture();
  try {
    const cached = official();
    const context = await buildOfficialArtistContext(cacheFor(cached, await scraperCacheFingerprint(CONFIG)), f.configsDir, Date.parse(NOW));
    const spoof = { ...cached, official: true, venue: 'Spoof Hall' } as Partial<Concert>;
    assert.equal(context.has(spoof), false);
    const result = await processConcerts([ordinary(), spoof], f.approved, NOW, undefined, undefined, context);
    assert.equal(result[0].venue, 'Old Hall');
  } finally { await f.cleanup(); }
});

test('malformed active config cannot grant authority', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.configsDir, 'renamed.json'), '{ bad json');
    const row = official();
    const context = await buildOfficialArtistContext(cacheFor(row, await scraperCacheFingerprint(CONFIG)), f.configsDir, Date.parse(NOW));
    assert.equal(context.has(row), false);
  } finally { await f.cleanup(); }
});

test('authority requires exact config, current fingerprint, valid verifiedAt and exact source domain', async () => {
  const f = await fixture();
  try {
    const fingerprint = await scraperCacheFingerprint(CONFIG);
    const row = official();
    const variants: Array<[string, ScrapeCache, ScraperConfig?]> = [
      ['stale fingerprint', cacheFor(row, 'stale')],
      ['missing verifiedAt', cacheFor(row, fingerprint, '')],
      ['future verifiedAt', cacheFor(row, fingerprint, '2026-09-29T00:00:00.000Z')],
      ['malformed verifiedAt', cacheFor(row, fingerprint, 'yesterday')],
      ['spoofed source', cacheFor(official({ originalSource: 'hueandcry.co.uk.evil.test' }), fingerprint)],
      ['other artist', cacheFor(official({ artist: 'Other Artist' }), fingerprint)],
      ['wrong domain', cacheFor(row, fingerprint), { ...CONFIG, domain: 'evil.test' }],
      ['wrong url', cacheFor(row, fingerprint), { ...CONFIG, url: 'https://hueandcry.co.uk/other/' }]
    ];
    for (const [name, cache, config] of variants) {
      const current = config ? await fixture(config) : f;
      try {
        const context = await buildOfficialArtistContext(cache, current.configsDir, Date.parse(NOW));
        assert.equal(context.has(cache['artist-hue-cry'].concerts[0]), false, name);
      } finally { if (config) await current.cleanup(); }
    }
  } finally { await f.cleanup(); }
});

test('old cached content remains authoritative after successful verification and later scrape failure', async () => {
  const f = await fixture();
  try {
    const row = official({ scrapedAt: '2026-01-01T00:00:00.000Z' });
    const cache = cacheFor(row, await scraperCacheFingerprint(CONFIG), '');
    cache['artist-hue-cry'].scrapedAt = '2026-01-01T00:00:00.000Z';
    cache['artist-hue-cry'] = verifiedVenueCacheEntry(cache['artist-hue-cry'], { success: true }, NOW);
    cache['artist-hue-cry'] = verifiedVenueCacheEntry(cache['artist-hue-cry'], { success: false }, '2026-09-29T00:00:00.000Z');
    assert.equal(cache['artist-hue-cry'].scrapedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(cache['artist-hue-cry'].verifiedAt, NOW);
    const context = await buildOfficialArtistContext(cache, f.configsDir, Date.parse(NOW));
    assert.equal(context.get(row)?.artist, 'Hue & Cry');
    const result = await processConcerts([ordinary(), row], f.approved, NOW, undefined, undefined, context);
    assert.equal(result[0].venue, 'New Room');
  } finally { await f.cleanup(); }
});

test('invalid official row is filtered, and untrusted/equal-rank duplicates retain legacy selection', async () => {
  const f = await fixture();
  try {
    const fingerprint = await scraperCacheFingerprint(CONFIG);
    const bad = official({ lat: 999 });
    const context = await buildOfficialArtistContext(cacheFor(bad, fingerprint), f.configsDir, Date.parse(NOW));
    const result = await processConcerts([bad, ordinary()], f.approved, NOW, undefined, undefined, context);
    assert.equal(result.length, 1);
    assert.equal(result[0].venue, 'Old Hall');
    const untrusted = await processConcerts([ordinary(), official()], f.approved, NOW);
    assert.equal(untrusted[0].venue, 'Old Hall');
  } finally { await f.cleanup(); }
});

test('all curated sources match real configs and their verified whole records beat richer ordinary rows', async () => {
  const f = await fixture();
  try {
    await writeFile(f.approved, JSON.stringify(OFFICIAL_ARTIST_SOURCES.map(({ artist }) => ({ name: artist }))));
    const configsDir = path.resolve('scrapers/artists');
    const configs = await loadConfigs(configsDir);
    assert.equal(OFFICIAL_ARTIST_SOURCES.length, 5);
    for (const source of OFFICIAL_ARTIST_SOURCES) {
      const config = configs.find(c => c.id === source.configId)!;
      assert.ok(config, source.configId);
      assert.equal(config.url, source.url);
      assert.equal(config.domain, source.domain);
      const row = official({ artist: source.artist, originalSource: source.domain });
      const cache: ScrapeCache = { [source.configId]: {
        concerts: [row], contentHash: 'offline-test', scrapedAt: NOW, verifiedAt: NOW,
        cacheFingerprint: await scraperCacheFingerprint(config)
      } };
      const context = await buildOfficialArtistContext(cache, configsDir, Date.parse(NOW));
      assert.equal(context.has(row), true, source.configId);
      const aggregate = ordinary({ artist: source.artist });
      for (const rows of [[aggregate, row], [row, aggregate]]) {
        const result = await processConcerts(rows, f.approved, NOW, undefined, undefined, context);
        assert.equal(result.length, 1, source.configId);
        assert.equal(result[0].originalSource, source.domain);
        assert.equal(result[0].venue, 'New Room');
        assert.equal(result[0].lat, undefined);
        assert.equal(result[0].startTime, undefined);
      }
      cache[source.configId].cacheFingerprint = 'old-implementation';
      assert.equal((await buildOfficialArtistContext(cache, configsDir, Date.parse(NOW))).has(row), false);
    }
  } finally { await f.cleanup(); }
});
