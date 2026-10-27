import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveBandsintownCache, type BandsintownCache } from '../src/engine/bandsintown.js';
import { saveApprovedArtists } from '../src/pipeline/artistDb.js';

const execute = promisify(execFile);
const script = path.resolve('src/scripts/targeted_artist_refresh.ts');
const tsx = path.resolve('node_modules/tsx/dist/loader.mjs');
const preservedFiles = ['artist-scrape-cache.json', 'eventbrite-cache.json', 'artist-run-manifest.json', 'artist-source-health.json'];
const specialName = "$(touch INJECTED); O'Brien";

function event() {
  return {
    starts_at: '2027-06-22T20:30:00',
    artist: { name: 'Provider spelling' },
    url: 'https://www.bandsintown.com/e/123',
    offers: [{ url: 'https://tickets.example/123' }],
    venue: { name: 'Real venue', city: 'London', country: 'United Kingdom', latitude: '51.5', longitude: '-0.1' }
  };
}

async function fixture(t: test.TestContext, respond: (artist: string) => { status?: number; body: unknown } = () => ({ body: [event()] })) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'targeted-refresh-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'reports'));
  await fs.writeFile(path.join(root, 'data/artist_scrape_targets.txt'), `Alpha Artist\nBeta Artist\n${specialName}\n`);
  await saveApprovedArtists(path.join(root, 'data/artists'), [
    { name: 'Roster Pro', tier: 'professional' }, { name: 'Ineligible Artist', tier: 'longtail' }
  ]);
  const fresh = new Date(Date.now() - 1000).toISOString();
  const initial: BandsintownCache = Object.fromEntries(['Alpha Artist', 'Beta Artist', 'Unrelated Artist', 'Roster Pro', specialName].map((artist) => [artist, {
    fetchedAt: fresh, attemptedAt: fresh, verifiedAt: fresh, lastOutcome: 'events',
    concerts: [{ artist, date: '2027-01-01', venue: 'Last good' }]
  }]));
  const cachePath = path.join(root, 'reports/bandsintown-cache.json');
  await saveBandsintownCache(cachePath, initial);
  for (const file of preservedFiles) {
    await fs.writeFile(path.join(root, 'reports', file), JSON.stringify({ originalTimestamp: fresh, file }));
  }
  const originals = await Promise.all(preservedFiles.map((file) => fs.readFile(path.join(root, 'reports', file), 'utf8')));
  const requests: { artist: string; at: number; appId: string | null }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    const artist = decodeURIComponent(url.pathname.slice('/artists/'.length, -'/events'.length));
    requests.push({ artist, at: Date.now(), appId: url.searchParams.get('app_id') });
    const response = respond(artist);
    res.writeHead(response.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const preload = path.join(root, 'fixture-http.cjs');
  // Only reroute the HTTP destination in the child. The CLI, default collector
  // fetch (including status/payload validation), mapper and writer are real.
  await fs.writeFile(preload, `
    const axios = require(${JSON.stringify(require.resolve('axios'))});
    const originalGet = axios.get;
    axios.get = (url, config) => {
      if (!url.startsWith('https://rest.bandsintown.com/artists/')) throw new Error('Unexpected HTTP source');
      return originalGet('http://127.0.0.1:${address.port}' + new URL(url).pathname, config);
    };
  `);
  async function run(input: string | undefined, overrides: NodeJS.ProcessEnv = {}) {
    const env = { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', ARTIST_TARGET_NAMES_JSON: input,
      BANDSINTOWN_MAX_PER_RUN: '800', BANDSINTOWN_APP_ID: '', GITHUB_OUTPUT: path.join(root, 'outputs'), ...overrides };
    try {
      const result = await execute(process.execPath, ['--require', preload, '--import', tsx, script], { cwd: root, env, timeout: 30_000 });
      return { ...result, code: 0 };
    } catch (error: any) {
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
  }
  async function assertUnrunSourcesPreserved() {
    for (const [index, file] of preservedFiles.entries()) {
      assert.equal(await fs.readFile(path.join(root, 'reports', file), 'utf8'), originals[index], file);
    }
  }
  return { root, cachePath, initial, requests, run, assertUnrunSourcesPreserved,
    cache: async () => JSON.parse(await fs.readFile(cachePath, 'utf8')) as BandsintownCache,
    report: async () => JSON.parse(await fs.readFile(path.join(root, 'reports/targeted-artist-refresh.json'), 'utf8')) };
}

test('targeted CLI revalidates only two canonical requested fresh artists with real HTTP, mapper, delay and full-cache writer', async (t) => {
  const f = await fixture(t);
  const result = await f.run('["  ALPHA   ARTIST ", "Roster Pro", "alpha artist"]');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.requests.map((r) => r.artist).sort(), ['Alpha Artist', 'Roster Pro']);
  assert.ok(f.requests[1].at - f.requests[0].at >= 1050, 'normal 1.1s collector delay remains enabled');
  assert.ok(f.requests.every((r) => r.appId === 'js_127.0.0.1'));
  const cache = await f.cache();
  assert.deepEqual(Object.keys(cache).sort(), Object.keys(f.initial).sort());
  for (const artist of Object.keys(f.initial)) {
    if (['Alpha Artist', 'Roster Pro'].includes(artist)) {
      assert.notEqual(cache[artist].verifiedAt, f.initial[artist].verifiedAt);
      assert.equal(cache[artist].attemptedAt, cache[artist].verifiedAt);
      assert.deepEqual(cache[artist].concerts[0], {
        artist, date: '2027-06-22', startTime: '20:30', venue: 'Real venue', city: 'London', country: 'GB',
        lat: 51.5, lng: -0.1, ticketUrl: 'https://tickets.example/123', sourceEventUrl: 'https://www.bandsintown.com/e/123',
        originalSource: 'bandsintown.com', scrapedAt: cache[artist].verifiedAt
      });
    } else assert.deepEqual(cache[artist], f.initial[artist], artist);
  }
  const report = await f.report();
  assert.equal(report.scope, 'manual_targeted_bandsintown');
  assert.equal(report.success, true);
  assert.equal(report.health.counts.attempted, 2);
  assert.equal(report.health.counts.succeeded, 2);
  assert.ok(report.artists.every((artist: any) => artist.refreshed));
  assert.equal(await fs.readFile(path.join(f.root, 'outputs'), 'utf8'), 'cache_updated=true\n');
  await f.assertUnrunSourcesPreserved();
});

test('targeted CLI rejects invalid/unknown/ineligible names, nonmanual use and caps before any HTTP or writes', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.cachePath, 'utf8');
  for (const input of [undefined, '', ' ', 'null', '{}', '"Alpha Artist"', '[]', '[3]', '[""]', '["  "]', '["Alpha Artist", false]', '["Alpha Artist", "Unknown"]', '["Ineligible Artist"]']) {
    const result = await f.run(input);
    assert.equal(result.code, 1, `${input}: ${result.stderr}`);
  }
  for (const cap of ['0', '-1', 'NaN', '2.5', '801', '800junk', '']) {
    assert.equal((await f.run('["Alpha Artist"]', { BANDSINTOWN_MAX_PER_RUN: cap })).code, 1, cap);
  }
  assert.equal((await f.run('["Alpha Artist", "Beta Artist"]', { BANDSINTOWN_MAX_PER_RUN: '1' })).code, 1);
  assert.equal((await f.run('["Alpha Artist"]', { GITHUB_EVENT_NAME: 'schedule' })).code, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(await fs.readFile(f.cachePath, 'utf8'), before);
  assert.deepEqual((await fs.readdir(path.join(f.root, 'reports'))).sort(), ['bandsintown-cache.json', ...preservedFiles].sort());
  await assert.rejects(fs.access(path.join(f.root, 'outputs')));
  await f.assertUnrunSourcesPreserved();
});

test('targeted CLI refuses missing or corrupt restoration rather than replacing the full cache with a subset', async (t) => {
  const f = await fixture(t);
  for (const raw of ['{', '[]', 'null', '{"Other":{"concerts":null}}']) {
    await fs.writeFile(f.cachePath, raw);
    assert.equal((await f.run('["Alpha Artist"]')).code, 1);
    assert.equal(await fs.readFile(f.cachePath, 'utf8'), raw);
  }
  await fs.unlink(f.cachePath);
  assert.equal((await f.run('["Alpha Artist"]')).code, 1);
  await assert.rejects(fs.access(f.cachePath));
  assert.equal(f.requests.length, 0);
  await assert.rejects(fs.access(path.join(f.root, 'outputs')));
});

test('targeted CLI keeps shell syntax inside literal artist names as data', async (t) => {
  const f = await fixture(t);
  const result = await f.run(JSON.stringify([specialName, specialName]), { BANDSINTOWN_MAX_PER_RUN: '1' });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.requests.map((r) => r.artist), [specialName]);
  await assert.rejects(fs.access(path.join(f.root, 'INJECTED')));
});

test('targeted CLI reports partial failure for malformed/429 responses, preserves last-good and persists truthful attempts', async (t) => {
  for (const response of [
    { body: { error: 'challenge' } },
    { body: [event(), { ...event(), venue: { name: 'Missing country', city: 'London' } }] },
    { status: 429, body: { error: 'rate limited' } },
    { status: 404, body: { error: 'unavailable' } }
  ]) {
    await t.test(JSON.stringify(response), async (t) => {
      const f = await fixture(t, (artist) => artist === 'Alpha Artist' ? response : { body: [event()] });
      const result = await f.run('["Alpha Artist", "Beta Artist"]');
      assert.equal(result.code, 1, result.stderr);
      assert.equal(f.requests.length, 2);
      const cache = await f.cache();
      assert.deepEqual(cache['Alpha Artist'].concerts, f.initial['Alpha Artist'].concerts);
      assert.equal(cache['Alpha Artist'].verifiedAt, f.initial['Alpha Artist'].verifiedAt);
      assert.notEqual(cache['Alpha Artist'].attemptedAt, f.initial['Alpha Artist'].attemptedAt);
      assert.equal(cache['Alpha Artist'].lastOutcome, response.status === 404 ? 'unavailable' : 'failed');
      if (response.status !== 404) assert.equal(cache['Alpha Artist'].fetchedAt, f.initial['Alpha Artist'].fetchedAt);
      for (const artist of Object.keys(f.initial).filter((name) => !['Alpha Artist', 'Beta Artist'].includes(name))) {
        assert.deepEqual(cache[artist], f.initial[artist]);
      }
      const report = await f.report();
      assert.equal(report.success, false);
      assert.equal(report.health.counts.succeeded, 1);
      assert.equal(report.artists.find((artist: any) => artist.artist === 'Alpha Artist').refreshed, false);
      assert.equal(report.artists.find((artist: any) => artist.artist === 'Beta Artist').refreshed, true);
      assert.equal(await fs.readFile(path.join(f.root, 'outputs'), 'utf8'), 'cache_updated=true\n');
      await f.assertUnrunSourcesPreserved();
    });
  }
});

test('targeted CLI retains the five-consecutive-failure guard and marks deferred targets unsuccessful', async (t) => {
  const f = await fixture(t, () => ({ status: 429, body: {} }));
  const names = Array.from({ length: 7 }, (_, i) => `Guard ${i}`);
  await fs.writeFile(path.join(f.root, 'data/artist_scrape_targets.txt'), names.join('\n'));
  const result = await f.run(JSON.stringify(names));
  assert.equal(result.code, 1, result.stderr);
  assert.equal(f.requests.length, 5);
  const report = await f.report();
  assert.equal(report.health.halted.category, 'consecutive_failures');
  assert.equal(report.success, false);
  assert.equal(report.artists.filter((artist: any) => artist.attemptedAt).length, 5);
  assert.ok(report.artists.every((artist: any) => !artist.refreshed));
  const cache = await f.cache();
  for (const artist of Object.keys(f.initial)) assert.deepEqual(cache[artist], f.initial[artist]);
  assert.equal(cache['Guard 5'], undefined);
  assert.equal(cache['Guard 6'], undefined);
});
