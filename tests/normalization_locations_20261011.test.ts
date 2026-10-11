import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import net from 'node:net';
import dns from 'node:dns';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

const AT = '2026-10-11T05:00:00.000Z';
const DIR = 'tests/fixtures/normalization-location-20261011';
const CASES = [
  ['artist-randy-houser', 16, 16], ['artist-excision', 6, 6], ['artist-bastille', 8, 8],
  ['artist-admiral-fallow', 5, 5], ['artist-iration', 8, 8], ['artist-rachael-sage', 7, 7],
  ['artist-burak-yeter', 7, 4], ['artist-shelly-berg', 6, 4], ['artist-turmion-katilot', 34, 11]
] as const;

async function config(id: string) {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')));
}
async function fixture(id: string) {
  return readFile(`${DIR}/${id}.${id === 'artist-shelly-berg' ? 'json' : 'html'}`, 'utf8');
}
async function parser(id: string) {
  return import(`../src/engine/custom/${id}.js`);
}

test('nine real native calendars recover locations through the stock runner and strict pipeline without network', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(AT) });
  let attempts = 0;
  const blocked = () => { attempts++; throw new Error('Network forbidden in native fixture replay'); };
  t.mock.method(net.Socket.prototype, 'connect', blocked);
  t.mock.method(dns, 'lookup', blocked);
  t.mock.method(dns.promises, 'lookup', blocked);
  t.mock.method(globalThis, 'fetch', blocked);
  const prior = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  t.after(() => { if (prior === undefined) delete process.env.SCRAPER_HTTP_BACKEND; else process.env.SCRAPER_HTTP_BACKEND = prior; });
  for (const [id, rawCount, publicCount] of CASES) {
    const cfg = await config(id);
    const body = await fixture(id);
    t.mock.method(axios, 'get', async (url: string) => {
      assert.equal(url, cfg.url);
      return { status: 200, data: body, headers: {} };
    });
    const result = await runScraper(cfg);
    assert.equal(result.success, true, `${id}: ${result.error}`);
    assert.equal(result.concerts.length, rawCount, id);
    assert.ok(result.concerts.every(row => row.scrapedAt === AT));
    let diagnostics: ProcessingDiagnostics | undefined;
    const published = await processConcerts(result.concerts, 'data/artists', AT, undefined, value => { diagnostics = value; });
    assert.equal(published.length, publicCount, id);
    assert.equal(diagnostics?.dropped.zodFail, 0, id);
    assert.ok(published.every(row => row.date >= '2026-10-11' && /^[A-Z]{2}$/.test(row.country)));
  }
  assert.equal(attempts, 0);
});

test('unknown or contradictory country evidence cannot inherit configured fallback countries', async () => {
  const cases = [
    ['artist-randy-houser', 'Hokes Bluff, AL', 'Hokes Bluff, ZZ'],
    ['artist-excision', 'Live Oak, FL, US', 'Live Oak, FL, CA'],
    ['artist-bastille', 'Wānaka, New Zealand', 'Wānaka, CA'],
    ['artist-admiral-fallow', 'Liverpool Philharmonic Music Room, Liverpool, GB', 'Liverpool Philharmonic Music Room, Liverpool, ZZ'],
    ['artist-iration', 'Fresno, CA, 93702', 'Fresno, CA, Mexico'],
    ['artist-rachael-sage', 'Kingston, NY', 'Kingston, ZZ']
  ];
  for (const [id, original, invalid] of cases) {
    const body = await fixture(id);
    assert.ok(body.includes(original), id);
    await assert.rejects((await parser(id)).scrape(await config(id), body.replaceAll(original, invalid), AT), /verified|explicit|consistent|country|tuple/i, id);
  }
  const burak = await (await parser('artist-burak-yeter')).scrape(await config('artist-burak-yeter'),
    (await fixture('artist-burak-yeter')).replace('Netherlands', 'Atlantis'), AT);
  assert.equal(burak.find((row: { date: string }) => row.date === '2026-10-22')?.country, undefined);
  const turmion = await (await parser('artist-turmion-katilot')).scrape(await config('artist-turmion-katilot'),
    (await fixture('artist-turmion-katilot')).replace('DE Essen', 'ZZ Essen'), AT);
  assert.equal(turmion.find((row: { date: string }) => row.date === '2027-02-17')?.country, undefined);
  assert.equal(turmion.find((row: { city: string }) => row.city === 'Helsinki')?.country, undefined,
    'domestic-looking city names must not inherit FI');
});

test('native years, source calendar timezone, missing locations and festival/cruise boundaries stay strict', async () => {
  for (const [id, before, after] of [
    ['artist-randy-houser', 'datetime="Oct 17 2026 "', 'datetime="Oct 17 "'],
    ['artist-bastille', 'data-gig-datetime="2027-01-30T19:00:00+00:00"', 'data-gig-datetime="January 30"'],
    ['artist-admiral-fallow', 'Mon, Oct 19, 2026', 'Mon, Oct 19'],
    ['artist-turmion-katilot', '24.10.2026', '24.10.']
  ]) {
    const body = await fixture(id);
    assert.ok(body.includes(before), id);
    await assert.rejects((await parser(id)).scrape(await config(id), body.replace(before, after), AT), /date|year/i);
  }
  const shelly = JSON.parse(await fixture('artist-shelly-berg'));
  const rows = await (await parser('artist-shelly-berg')).scrape(await config('artist-shelly-berg'), JSON.stringify(shelly), AT);
  assert.equal(rows.some((row: { date: string }) => row.date === '2027-01-17'), false, 'a cruise interval is not a single port concert');
  assert.equal(rows.find((row: { date: string }) => row.date === '2026-12-12')?.country, undefined, 'missing native country must remain missing');
  const wrongDay = structuredClone(shelly);
  wrongDay.upcoming[0].startDate += 86400000;
  await assert.rejects((await parser('artist-shelly-berg')).scrape(await config('artist-shelly-berg'), JSON.stringify(wrongDay), AT), /date/);
  delete shelly.website.timeZone;
  await assert.rejects((await parser('artist-shelly-berg')).scrape(await config('artist-shelly-berg'), JSON.stringify(shelly), AT), /timezone/);
  const excision = await (await parser('artist-excision')).scrape(await config('artist-excision'), await fixture('artist-excision'), AT);
  assert.equal(excision.length, 6, 'three printed festival intervals remain excluded');
});

test('verified city spellings preserve provider identities and the exact unresolved Castle Hotel collision stays held', async () => {
  const randy = await (await parser('artist-randy-houser')).scrape(await config('artist-randy-houser'), await fixture('artist-randy-houser'), AT);
  assert.equal(randy.find((row: { date: string }) => row.date === '2027-05-06')?.city, 'Fort Worth');
  const turmion = await (await parser('artist-turmion-katilot')).scrape(await config('artist-turmion-katilot'), await fixture('artist-turmion-katilot'), AT);
  assert.deepEqual(turmion.filter((row: { date: string }) => ['2027-02-23', '2027-02-24', '2027-02-27'].includes(row.date)).map((row: { city: string }) => row.city), ['Wien', 'München', 'Mörlenbach']);
  const id = 'artist-rachael-sage';
  const body = await fixture(id);
  const rows = await (await parser(id)).scrape(await config(id), body, AT);
  assert.equal(rows.some((row: { date: string }) => row.date === '2026-10-30'), false);
  const nearby = await (await parser(id)).scrape(await config(id), body.replace('10/30/2026', '10/30/2027'), AT);
  assert.ok(nearby.some((row: { date: string; city: string }) => row.date === '2027-10-30' && row.city === 'Manchester'));
});
