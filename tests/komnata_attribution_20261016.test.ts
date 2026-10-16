import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper, loadConfigs } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/komnata-kultury-tour.js';
import { filterArtistCacheForActiveConfigs } from '../src/engine/artist_cache.js';
import { hashConcerts, loadCache, saveCache, type ScrapeCache } from '../src/engine/cache.js';
import { parseDate, processConcerts } from '../src/pipeline/process.js';

const html = readFileSync('tests/fixtures/komnata-20261016/original.html', 'utf8');
const config = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/artists/komnata-kultury-tour.json', 'utf8')));
const retiredConfig = ScraperConfigSchema.parse(JSON.parse(readFileSync('tests/fixtures/komnata-20261016/retired-zhenya-config.json', 'utf8')));
const at = '2026-10-16T18:55:16.249Z';
const configsDir = path.join(process.cwd(), 'scrapers', 'artists');

// These are primary ticket data already embedded in the captured source, not
// seller requests or a source-wide inferred year.
function nativeTicketDate(href: string): string | undefined {
  const url = new URL(href);
  if (url.hostname === 'widget.afisha.yandex.ru' && url.pathname.startsWith('/w/sessions/')) {
    const tuple = Buffer.from(url.pathname.split('/').at(-1)!, 'base64url').toString('utf8').split('|');
    assert.equal(tuple.length, 4);
    assert.match(tuple[3], /^\d{13}$/);
    return new Date(Number(tuple[3])).toISOString().slice(0, 10);
  }
  if (url.hostname === 'artzvezdy.ru') {
    const value = url.searchParams.get('utm_campaign')?.match(/(\d{2})(\d{2})(20\d{2})$/);
    if (value) return `${value[3]}-${value[2]}-${value[1]}`;
  }
  return undefined;
}

test('native group title/billing yields 24 canonical group rows and no solo rows', async t => {
  const $ = cheerio.load(html);
  assert.equal($('title').text(), 'Комната культуры');
  assert.match($('h1,h2').text(), /Официальный сайт Группа Комната Культуры/);
  const billing = $('a[href*="gruppa-komnata-kultury"]');
  assert.ok(billing.length >= 3);
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 24);
  assert.ok(result.concerts.every(row => row.artist === 'Комната культуры'));
  const published = await processConcerts(result.concerts, 'data/artists', at);
  assert.equal(published.length, 24);
  assert.ok(published.every(row => row.artist === 'Комната культуры'));
  const active = await loadConfigs(configsDir);
  assert.ok(active.some(c => c.id === config.id));
  assert.equal(active.some(c => c.id === retiredConfig.id), false);
});

test('retiring the false solo config excludes all 24 cached solo rows through the real daily consumer path', async t => {
  const canonical = await scrape(config, html, at);
  const falseSolo = await scrape(retiredConfig, html, at);
  // Positive control: the old config really did produce wrong accepted solo rows.
  assert.equal(falseSolo.length, 24);
  assert.ok(falseSolo.every(row => row.artist === 'Женя Трофимов'));
  const before = await processConcerts([...canonical, ...falseSolo], 'data/artists', at);
  assert.equal(before.filter(row => row.artist === 'Женя Трофимов').length, 24);
  const peer = { artist: 'Браво', date: '2026-11-21', venue: 'Atmosphere', city: 'Москва', country: 'RU',
    originalSource: 'www.bravogroup.ru', scrapedAt: at };
  const entry = (concerts: typeof canonical) => ({ scrapedAt: at, contentHash: hashConcerts(concerts), concerts });
  const seeded: ScrapeCache = { [config.id]: entry(canonical), [retiredConfig.id]: entry(falseSolo), 'bravo-tour': entry([peer]) };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'komnata-cache-retirement-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const cachePath = path.join(temp, 'artist-scrape-cache.json');
  await saveCache(cachePath, seeded);
  const loaded = await loadCache(cachePath);
  const active = await filterArtistCacheForActiveConfigs(loaded, configsDir);
  assert.deepEqual(Object.keys(active), [config.id, 'bravo-tour']);
  assert.deepEqual(active[config.id], seeded[config.id]);
  assert.deepEqual(active['bravo-tour'], seeded['bravo-tour']);
  // Filtering is a read-only view: old bytes may stay stored but cannot publish.
  assert.equal((await loadCache(cachePath))[retiredConfig.id].concerts.length, 24);
  const output = await processConcerts(Object.values(active).flatMap(e => e.concerts), 'data/artists', at);
  assert.equal(output.filter(row => row.artist === 'Женя Трофимов').length, 0);
  assert.equal(output.filter(row => row.artist === 'Комната культуры').length, 24);
  assert.equal(output.filter(row => row.artist === 'Браво').length, 1);
});

test('all eleven embedded full ticket dates agree with the existing project date contract', async () => {
  const rows = await scrape(config, html, at);
  const evidenced = rows.flatMap(row => {
    const native = row.ticketUrl && nativeTicketDate(row.ticketUrl);
    if (!native) return [];
    const visible = row.date!.match(/^(\d{1,2})\/(\d{1,2})$/)!;
    assert.equal(native.slice(5), `${visible[2].padStart(2, '0')}-${visible[1].padStart(2, '0')}`);
    assert.equal(parseDate(row.date!, at), native);
    return [{ native, city: row.city }];
  });
  assert.equal(evidenced.length, 11);
  assert.ok(evidenced.some(row => row.city === 'Волгоград' && row.native === '2026-10-26'));
  assert.ok(evidenced.some(row => row.city === 'Ярославль' && row.native === '2026-11-19'));
  assert.ok(evidenced.some(row => row.city === 'Липецк' && row.native === '2027-03-17'));
  assert.equal(rows.length - evidenced.length, 13); // no full year witness on these ticket URLs
});
