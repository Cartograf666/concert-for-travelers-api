import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape as blue } from '../src/engine/custom/artist-blue-october.js';
import { scrape as teen } from '../src/engine/custom/artist-teenage-fanclub.js';
import { scrape as moz } from '../src/engine/custom/artist-wolfgang-amadeus-mozart.js';
import { processConcerts } from '../src/pipeline/process.js';
import { runScraper } from '../src/engine/runner.js';

const at = '2026-10-10T10:53:27.910Z';
const fixtures = 'tests/fixtures/official-source-resilience-20261011';
const config = async (id: string) => ScraperConfigSchema.parse(JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')));
const captured = (name: string) => readFile(`${fixtures}/${name}`, 'utf8');

test('actual nested Wix calendar independently publishes 70 dated Blue October shows with US/Canada evidence', async () => {
  const raw = await blue(await config('artist-blue-october'), await captured('blue-october.html'), at);
  assert.equal(raw.length, 70);
  assert.equal(raw.filter(row => row.country === 'CA').length, 3);
  assert.equal(raw.filter(row => row.country === 'US').length, 67);
  assert.deepEqual(raw.filter(row => row.country === 'CA').map(row => row.city), ['Toronto', 'Montreal', 'Vancouver']);
  const published = await processConcerts(raw, 'data/artists', at);
  assert.equal(published.length, 70);
  assert.ok(published.every(row => row.artist === 'Blue October' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)));
  assert.equal(raw.find(row => row.date === '2027-02-10')?.city, 'San Luis Obispo');
  assert.equal(raw.find(row => row.date === '2026-11-11')?.city, 'North Tonawanda');
});

test('Blue October rejects invalid full dates and does not guess unfamiliar country or inherit a moved venue', async () => {
  const c = await config('artist-blue-october');
  const $ = cheerio.load(await captured('blue-october.html'));
  const card = $('div.wixui-repeater__item').filter((_, el) => $(el).find('[id^="comp-lh7wnc2h__"]').text().includes('November 11, 2026')).first();
  card.find('[id^="comp-lh7wpx2j__"]').text('New venue after relocation');
  const moved = await blue(c, $.html(card), at);
  assert.equal(moved[0].venue, 'New venue after relocation');
  assert.equal(moved[0].city, 'Buffalo');
  assert.equal(moved[0].lat, undefined);
  card.find('[id^="comp-lh7yohlq__"]').text('Unverified city, GB');
  const unknown = await blue(c, $.html(card), at);
  assert.equal(unknown[0].country, undefined);
  assert.equal((await processConcerts(unknown, 'data/artists', at)).length, 0);
  card.find('[id^="comp-lh7wnc2h__"]').text('February 31, 2027');
  assert.deepEqual(await blue(c, $.html(card), at), []);
});

test('Teenage Fanclub parses 41 exact current-heading dates, sold-out rows and repeated venue text', async () => {
  const raw = await teen(await config('artist-teenage-fanclub'), await captured('teenage-fanclub.html'), at);
  assert.equal(raw.length, 41);
  assert.equal(raw.find(row => row.date === '2026-11-21')?.venue, 'SWG3 Warehouse');
  assert.equal(raw.find(row => row.date === '2026-10-19')?.venue, 'Marché Gare');
  assert.equal(raw.find(row => row.date === '2026-10-10')?.country, 'ES');
  assert.equal(raw.find(row => row.date === '2026-10-24')?.country, 'BE');
  assert.ok(raw.every(row => row.date?.startsWith('2026-')));
  assert.ok(raw.every(row => !/Tickets|SOLD OUT/.test(row.venue || '')));
});

test('Teenage Fanclub retains sold-out concerts without anchors but cannot invent country/year', async () => {
  const c = await config('artist-teenage-fanclub');
  const html = '<div class="sqs-html-content"><h1>Tour Dates 2026</h1>' +
    '<p>Oct 10, 2026 - Oviedo - Almacenes Kuivi - SOLD OUT</p>' +
    '<p>Oct 12, 2026 - Unverified city - Unknown venue - Tickets</p>' +
    '<p>Oct 14 - Oviedo - Almacenes Kuivi - Tickets</p>' +
    '<p>Feb 31, 2026 - Oviedo - Almacenes Kuivi - Tickets</p></div>';
  const raw = await teen(c, html, at);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].country, 'ES');
  assert.equal(raw[0].ticketUrl, undefined);
  assert.equal(raw[1].country, undefined);
  assert.equal((await processConcerts(raw, 'data/artists', at)).length, 1);
});

test('Mozarteum native full-date programme retains Mozart Requiem and omits museum tour and title-only claims', async () => {
  const c = await config('artist-wolfgang-amadeus-mozart');
  const json = await captured('mozarteum.json');
  const raw = await moz(c, json, at);
  const requiem = raw.find(row => row.sourceEventUrl?.endsWith('/mozart-requiem-mozarteumorchester-salzburg-pinnock'));
  assert.equal(requiem?.date, '2026-12-05');
  assert.equal(requiem?.startTime, '19:00');
  assert.equal(requiem?.city, 'Salzburg');
  assert.equal(requiem?.country, 'AT');
  assert.equal(requiem?.venue, 'Stiftung Mozarteum, Großer Saal');
  assert.ok(!raw.some(row => row.sourceEventUrl?.includes('fuehrung-zu-mozarts-todestag')));
  assert.ok(raw.every(row => /^20\d{2}-\d{2}-\d{2}$/.test(row.date || '')));
  assert.ok((await processConcerts(raw, 'data/artists', at)).some(row => row.date === '2026-12-05'));
  const parsed = JSON.parse(json);
  const native = parsed.result.data.events.find((event: { slugDe: string }) => event.slugDe === 'mozart-requiem-mozarteumorchester-salzburg-pinnock');
  native.infoDe = '<p>This venue is named Mozart. A Weinberg programme without Mozart credit.</p>';
  parsed.result.data.events = [native];
  assert.deepEqual(await moz(c, JSON.stringify(parsed), at), []);
});

test('Mozarteum rejects year-less native dates, foreign source identity and malformed feed', async () => {
  const c = await config('artist-wolfgang-amadeus-mozart');
  const parsed = JSON.parse(await captured('mozarteum.json'));
  const native = parsed.result.data.events.find((event: { slugDe: string }) => event.slugDe === 'mozart-requiem-mozarteumorchester-salzburg-pinnock');
  native.concertLocationTimes[0].date = '05 Dez';
  parsed.result.data.events = [native];
  await assert.rejects(moz(c, JSON.stringify(parsed), at), /full native date/);
  await assert.rejects(moz({ ...c, domain: 'mozarteum.at.attacker.test' }, '{}', at), /identity/);
  await assert.rejects(moz(c, '{}', at));
});

test('all three real custom modules work through stock runner on native captures without provider requests', async () => {
  const original = axios.get;
  const backend = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  try {
    for (const [id, file] of [['artist-blue-october', 'blue-october.html'], ['artist-teenage-fanclub', 'teenage-fanclub.html'], ['artist-wolfgang-amadeus-mozart', 'mozarteum.json']]) {
      const c = await config(id);
      const body = await captured(file);
      axios.get = (async (url: string) => {
        assert.equal(url, c.url, 'only this exact native capture is served');
        return { status: 200, data: body, headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'text/html' } };
      }) as typeof axios.get;
      const result = await runScraper(c);
      assert.equal(result.success, true, `${id}: ${result.error}`);
      assert.ok(result.concerts.length > 0);
    }
  } finally {
    axios.get = original;
    if (backend === undefined) delete process.env.SCRAPER_HTTP_BACKEND;
    else process.env.SCRAPER_HTTP_BACKEND = backend;
  }
});
