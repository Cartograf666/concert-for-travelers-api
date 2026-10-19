import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as net from 'node:net';
import * as cheerio from 'cheerio';
import { runScraper } from '../src/engine/runner.js';
import { extractJsonLd } from '../src/engine/structured.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { buildApprovedMatcher, processConcerts } from '../src/pipeline/process.js';

const fixtures = new URL('./fixtures/ru-data-2-east/', import.meta.url);
const fixturePath = new URL('approved-identity-input.json', fixtures).pathname;
const manifest = JSON.parse(readFileSync(new URL('capture-manifest.json', fixtures), 'utf8'));
const clock = manifest.clock as string;

// Capture snapshots and diagnostic probes only: none of these incomplete sources
// is installed as a production config, and no restricted seller fixture is reused.
test('official east native response fixtures preserve the dated HTTP payload hashes', async () => {
  for (const entry of manifest.captures) {
    const bytes = await readFile(new URL(entry.fixture, fixtures));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.status, 200);
    assert.ok(Date.parse(entry.capturedAt) <= Date.parse(clock));
  }
  assert.deepEqual(manifest.admittedRuntimeConfigs, []);
  assert.equal(manifest.doraAccess.length, 2);
  for (const capture of manifest.doraAccess) {
    assert.match(capture.error, /timed out/i);
    assert.ok(!('status' in capture), 'transport failure is not an HTTP empty schedule');
  }
});

test('native runScraper cannot mistake these unstructured official responses for empty JSON-LD calendars', async t => {
  const require = createRequire(import.meta.url);
  const axios = require('axios');
  const oldBackend = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  const responses = new Map<string, string>();
  for (const probe of manifest.probes) responses.set(probe.config.url, await readFile(new URL(probe.fixture, fixtures), 'utf8'));
  const reads: string[] = [];
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(clock) });
  t.mock.method(net.Socket.prototype, 'connect', () => { throw new Error('Offline test forbids socket access'); });
  t.mock.method(axios, 'get', async (url: string) => {
    assert.ok(responses.has(url), `uncaptured request ${url}`);
    reads.push(url);
    return { status: 200, data: responses.get(url), headers: {} };
  });
  try {
    for (const probe of manifest.probes) {
      const result = await runScraper(ScraperConfigSchema.parse(probe.config));
      assert.equal(result.scrapedAt, clock);
      assert.equal(result.success, false, probe.config.id);
      assert.notEqual(result.reason, 'empty_schedule');
      assert.deepEqual(result.concerts, []);
    }
    assert.deepEqual(reads, manifest.probes.map((p: any) => p.config.url));
  } finally {
    if (oldBackend === undefined) delete process.env.SCRAPER_HTTP_BACKEND;
    else process.env.SCRAPER_HTTP_BACKEND = oldBackend;
    t.mock.restoreAll();
    t.mock.timers.reset();
  }
});

test('captured Kino identity is the touring Tsoi-voice group and its country is not invented', async () => {
  const $ = cheerio.load(await readFile(new URL('kino-home.html', fixtures), 'utf8'));
  assert.equal($('title').text().trim(), 'Официальный сайт группы КИНО');
  const text = $('body').text().replace(/\s+/g, ' ');
  assert.match(text, /Голос Виктора Цоя был оцифрован/);
  assert.match(text, /Александр Титов и Игорь Тихомиров/);
  assert.equal($('.tour-item__title').length, 23);
  assert.equal($('script[type="application/ld+json"]').length, 0);
  assert.equal($('[itemprop="addressCountry"], [data-country]').length, 0);
});

test('Monetochka year headings keep old November dates in 2025; the latest native website date is September 2026', async () => {
  const $ = cheerio.load(await readFile(new URL('monetochka-home.html', fixtures), 'utf8'));
  assert.equal($('title').text().trim(), 'Монеточка. Fairy Tale Tour');
  const schedule = $('.tn-atom').filter((_, e) => $(e).text().includes('12.06 / WARSAW')).first();
  schedule.find('br').replaceWith('\n');
  const lines = schedule.text().split('\n').map(v => v.trim()).filter(Boolean);
  let year = '';
  const dates: string[] = [];
  for (const line of lines) {
    if (/^20\d{2}$/.test(line)) { year = line; continue; }
    const match = /^(\d{1,2})\.(\d{2})\s*\//.exec(line);
    assert.ok(match && year, line);
    dates.push(`${year}-${match[2]}-${match[1].padStart(2, '0')}`);
    if (line.startsWith('9.11 / riga')) assert.equal(year, '2025');
  }
  assert.equal(dates.length, 58);
  assert.equal([...dates].sort().at(-1), manifest.monetochka.maxAnnouncedDate);
  assert.equal(dates.filter(date => date >= clock.slice(0, 10)).length, 0);
});

test('Lumen available homepage proves upcoming concerts, not a complete or country-qualified calendar', async () => {
  const $ = cheerio.load(await readFile(new URL('lumen-home.html', fixtures), 'utf8'));
  assert.match($('body').text(), /Официальный сайт группы/);
  assert.equal($('.one_concert').length, 5);
  assert.match($('.concert_list .month').first().text(), /2026 Октябрь/);
  assert.equal($('.one_concert .concert_city').first().text().trim(), 'Челябинск');
  assert.equal($('script[type="application/ld+json"], [itemprop="addressCountry"], [data-country]').length, 0);
});

test('approved identity input keeps RU Kino/Dora separate from foreign namesakes in real normalization', async () => {
  const artists = JSON.parse(await readFile(fixturePath, 'utf8'));
  const match = buildApprovedMatcher(artists);
  const names = ['Кино', 'Kino', 'Дора', 'Dora', 'Doro', 'Doro Pesch', 'Монеточка', 'Lumen'];
  const rows = names.map(artist => ({ artist, date: '2026-11-10', city: 'Berlin', country: 'DE', venue: 'Synthetic identity control', originalSource: 'identity-control.example', scrapedAt: clock }));
  const output = await processConcerts(rows, fixturePath, clock);
  assert.equal(output.length, names.length);
  for (const input of names) assert.equal(output.find(row => row.artist === input)?.mbid, match(input)?.mbid);
  assert.notEqual(match('Кино')?.mbid, match('Kino')?.mbid);
  for (const foreign of ['Dora', 'Doro', 'Doro Pesch']) assert.notEqual(match('Дора')?.mbid, match(foreign)?.mbid);
});

test('native pipeline rejects missing country instead of manufacturing geography from an official artist name', async () => {
  const rows = [{ artist: 'Кино', date: '2026-10-29', city: 'Москва', venue: 'TAU', originalSource: 'kino.band', scrapedAt: clock },
    { artist: 'Lumen', date: '2026-10-20', city: 'Челябинск', venue: 'Максимиллианс', originalSource: 'lumen.ws', scrapedAt: clock }];
  const output = await processConcerts(rows, fixturePath, clock);
  assert.deepEqual(output, []);
});

test('reused JSON-LD engine has positive control and skips products or undated events', () => {
  const config = ScraperConfigSchema.parse({ id: 'dora-tour', url: 'https://realdora.com/', domain: 'realdora.com', type: 'jsonld' });
  const event = { '@type': 'MusicEvent', performer: { name: 'Дора' }, name: 'Synthetic control', startDate: '2026-11-10',
    location: { name: 'Synthetic hall', address: { addressLocality: 'Berlin', addressCountry: 'DE' } } };
  const html = (nodes: unknown[]) => `<script type="application/ld+json">${JSON.stringify(nodes)}</script>`;
  const result = extractJsonLd(config, html([event, { ...event, '@type': 'Product' }, { ...event, startDate: undefined }]), clock);
  assert.equal(result.length, 1);
  assert.equal(result[0].artist, 'Дора');
  assert.equal(result[0].date, '2026-11-10');
  assert.deepEqual(extractJsonLd(config, html([{ ...event, '@type': 'Product' }, { ...event, startDate: undefined }]), clock), []);
});
