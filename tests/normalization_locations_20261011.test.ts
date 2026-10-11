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
  ['artist-randy-houser', 15, 15], ['artist-excision', 6, 6], ['artist-bastille', 8, 8],
  ['artist-admiral-fallow', 5, 5], ['artist-iration', 7, 7], ['artist-rachael-sage', 8, 8],
  ['artist-burak-yeter', 7, 2], ['artist-shelly-berg', 6, 4], ['artist-turmion-katilot', 34, 11],
  ['artist-suchmos', 8, 8], ['artist-bonnie-pink', 6, 6], ['artist-ann-reed', 11, 4],
  ['artist-josh-nelson', 4, 4], ['artist-oasis', 40, 29], ['artist-aaron-copland', 23, 22],
  ['artist-showaddywaddy', 115, 25], ['artist-paul-carrack', 8, 2],
  ['artist-american-composers-orchestra', 3, 3]
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

test('eighteen real native calendars recover locations through the stock runner and strict pipeline without network', async t => {
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
  const randy = await (await parser('artist-randy-houser')).scrape(await config('artist-randy-houser'), await fixture('artist-randy-houser'), AT);
  assert.equal(randy.some((row: { venue: string }) => row.venue === 'Top Shelf Country Cruise'), false);
  const iration = await (await parser('artist-iration')).scrape(await config('artist-iration'), await fixture('artist-iration'), AT);
  assert.equal(iration.some((row: { venue: string }) => row.venue === 'Closer To The Sun'), false);
});

test('verified city spellings and primary Castle Hotel row retain native geography', async () => {
  const randy = await (await parser('artist-randy-houser')).scrape(await config('artist-randy-houser'), await fixture('artist-randy-houser'), AT);
  assert.equal(randy.find((row: { date: string }) => row.date === '2027-05-06')?.city, 'Fort Worth');
  const turmion = await (await parser('artist-turmion-katilot')).scrape(await config('artist-turmion-katilot'), await fixture('artist-turmion-katilot'), AT);
  assert.deepEqual(turmion.filter((row: { date: string }) => ['2027-02-23', '2027-02-24', '2027-02-27'].includes(row.date)).map((row: { city: string }) => row.city), ['Wien', 'München', 'Mörlenbach']);
  const id = 'artist-rachael-sage';
  const body = await fixture(id);
  const rows = await (await parser(id)).scrape(await config(id), body, AT);
  assert.equal(rows.find((row: { city: string }) => row.city === 'Kingston')?.date, '2026-10-11',
    'the native US date 10/11 must not become November 10');
  assert.equal(rows.find((row: { date: string; city: string }) => row.date === '2026-10-30')?.city, 'Manchester');
  const nearby = await (await parser(id)).scrape(await config(id), body.replace('10/30/2026', '10/30/2027'), AT);
  assert.ok(nearby.some((row: { date: string; city: string }) => row.date === '2027-10-30' && row.city === 'Manchester'));
});

test('exact Japanese venue proofs replace blurbs without extending JP to an unknown or foreign venue', async () => {
  for (const [id, printed, foreign] of [
    ['artist-suchmos', 'Kアリーナ横浜 (神奈川県)', 'K-Arena Berlin (Germany)'],
    ['artist-bonnie-pink', 'ビルボードライブ東京', 'ビルボードライブBerlin']
  ]) {
    const body = await fixture(id);
    assert.ok(body.includes(printed));
    const rows = await (await parser(id)).scrape(await config(id), body.replaceAll(printed, foreign), AT);
    const dates = id === 'artist-suchmos' ? ['2027-04-24', '2027-04-25'] : ['2026-12-06'];
    assert.ok(rows.filter((row: { date: string }) => dates.includes(row.date)).every((row: { country?: string; city?: string }) => row.country === undefined && row.city === undefined));
  }
  const bonnie = await (await parser('artist-bonnie-pink')).scrape(await config('artist-bonnie-pink'), await fixture('artist-bonnie-pink'), AT);
  assert.equal(bonnie.find((row: { date: string }) => row.date === '2027-04-15')?.city, 'Koto-ku', 'the postponed Zepp date survives its past cancellation notice');
  assert.equal(bonnie.some((row: { date: string }) => row.date === '2026-09-21'), false);
  assert.deepEqual(bonnie.filter((row: { date: string }) => row.date === '2026-10-11').map((row: { city: string; startTime: string }) => [row.city, row.startTime]), [['Ono', '19:00']]);
});

test('physical-show extraction cannot invent venues, countries, county cities or a single date from a period', async () => {
  const ann = await (await parser('artist-ann-reed')).scrape(await config('artist-ann-reed'), await fixture('artist-ann-reed'), AT);
  assert.equal(ann.some((row: { date: string }) => row.date === '2026-10-15'), false, 'the explicit livestream is not a physical concert');
  assert.equal(ann.find((row: { date: string }) => row.date === '2026-10-24')?.venue, undefined, 'details-coming-soon has no invented venue');
  const josh = await (await parser('artist-josh-nelson')).scrape(await config('artist-josh-nelson'), await fixture('artist-josh-nelson'), AT);
  assert.equal(josh.length, 4);
  assert.equal(josh.some((row: { date: string }) => row.date === '2026-11-20'), false, 'Tokyo period does not establish one performance day');
  assert.equal(josh.find((row: { date: string }) => row.date === '2026-10-27')?.city, 'Los Angeles');
  const id = 'artist-oasis';
  const body = await fixture(id);
  const oasis = await (await parser(id)).scrape(await config(id), body, AT);
  assert.ok(oasis.filter((row: { venue: string }) => row.venue === 'Knebworth Park' || row.venue === 'Slane Castle' || row.venue === 'Gillette Stadium').every((row: { city?: string }) => row.city === undefined));
  const falseCountry = await (await parser(id)).scrape(await config(id), body.replaceAll('Rome, Italy', 'Rome, CA'), AT);
  assert.ok(falseCountry.filter((row: { city: string }) => row.city === 'Rome').every((row: { country?: string }) => row.country === undefined));
  const burak = await (await parser('artist-burak-yeter')).scrape(await config('artist-burak-yeter'), await fixture('artist-burak-yeter'), AT);
  assert.equal(burak.find((row: { date: string }) => row.date === '2026-10-24')?.city, undefined, 'Hatay province is not a proven city');
  assert.equal(burak.find((row: { date: string }) => row.date === '2027-05-29')?.venue, undefined, 'an event-series title is not a proven physical venue');
});

test('Copland program credits and exact enumerated dates are required; no mixed-program attribution or range endpoint guessing', async () => {
  const id = 'artist-aaron-copland';
  const body = await fixture(id);
  const cfg = await config(id);
  const rows = await (await parser(id)).scrape(cfg, body, AT);
  assert.deepEqual(rows.filter((row: { city: string }) => row.city === 'Singapore').map((row: { date: string; startTime: string; country: string }) => [row.date, row.startTime, row.country]), [['2026-11-27', '19:30', 'SG'], ['2026-11-28', '19:30', 'SG']]);
  assert.equal(rows.find((row: { date: string; city: string }) => row.date === '2026-10-16' && row.city === 'Frankfurt (Oder)')?.country, 'DE');
  await assert.rejects((await parser(id)).scrape(cfg, body.replaceAll('COPLAND', 'OTHER').replaceAll('Aaron Copland', 'Other Composer'), AT), /credit|performers/);
  await assert.rejects((await parser(id)).scrape(cfg, body.replace('Nov 27th &amp; 28th, 2026', 'Nov 27th - 28th, 2026'), AT), /date/);
  await assert.rejects((await parser(id)).scrape(cfg, body.replace('Oct 16th, 2026', 'Feb 30th, 2026'), AT), /impossible/);
  await assert.rejects((await parser(id)).scrape(cfg, body.replaceAll('Germany', 'Atlantis'), AT), /country/);
});

test('three exact Showaddywaddy venue proofs recover six native dates without extending GB to similar labels', async () => {
  const id = 'artist-showaddywaddy';
  const body = await fixture(id);
  const cfg = await config(id);
  const rows = await (await parser(id)).scrape(cfg, body, AT);
  const locations = ['Wimborne Minster', 'Christchurch', 'Skegness'];
  const added = rows.filter((row: { city: string; country?: string }) => locations.includes(row.city) && row.country === 'GB');
  assert.deepEqual(added.map((row: { date: string }) => row.date), ['2026-11-27', '2027-01-21', '2027-05-28', '2027-11-26', '2028-01-08', '2028-05-26']);
  const variants = body.replaceAll('Wimborne - Tivoli Theatre', 'Wimborne - Tivoli Theatre Annex')
    .replaceAll('Christchurch - The Regent', 'Christchurch - The Regent Abroad')
    .replaceAll('Skegness - Embassy Theatre', 'Skegness - Embassy Theatre Annex');
  const unknown = await (await parser(id)).scrape(cfg, variants, AT);
  assert.ok(unknown.filter((row: { venue: string }) => /Annex|Abroad/.test(row.venue)).every((row: { country?: string }) => row.country === undefined));
  assert.equal(rows.some((row: { city: string; date: string }) => row.city === 'Castlebar' && row.date === '2026-12-06'), false);
});

test('Paul Carrack can only use the explicit same-record Germany Live year with matching venue/city evidence', async () => {
  const id = 'artist-paul-carrack';
  const body = await fixture(id);
  const cfg = await config(id);
  const rows = await (await parser(id)).scrape(cfg, body, AT);
  assert.deepEqual(rows.filter((row: { date?: string }) => row.date).map((row: { date: string; city: string; country: string }) => [row.date, row.city, row.country]), [['2026-10-18', 'Berlin', 'DE'], ['2026-10-19', 'Zwickau', 'DE']]);
  assert.ok(rows.filter((row: { date?: string }) => !row.date).every((row: { country?: string }) => row.country === undefined));
  const noYear = await (await parser(id)).scrape(cfg, body.replaceAll('germany-live-2026-', 'germany-live-'), AT);
  assert.ok(noYear.every((row: { date?: string; country?: string }) => row.date === undefined && row.country === undefined));
  const wrongCity = await (await parser(id)).scrape(cfg, body.replace('Berlin', 'London'), AT);
  assert.equal(wrongCity.find((row: { city: string }) => row.city === 'London')?.country, undefined);
});

test('ACO direct concerts use component dates and real performer credits without treating commissions or gala as orchestra appearances', async () => {
  const id = 'artist-american-composers-orchestra';
  const cfg = await config(id);
  const body = await fixture(id);
  const rows = await (await parser(id)).scrape(cfg, body, AT);
  assert.deepEqual(rows.map((row: { date: string; startTime: string; city: string }) => [row.date, row.startTime, row.city]), [['2026-10-27', '19:30', 'New York'], ['2026-12-05', '20:00', 'New York'], ['2027-03-18', '19:30', 'New York']]);
  assert.equal(rows.some((row: { city: string }) => row.city === 'Amarillo'), false);
  assert.equal(rows.some((row: { startTime: string }) => row.startTime === '17:30'), false, 'the pre-concert gala is not the concert');
  await assert.rejects((await parser(id)).scrape(cfg, body.replaceAll('American Composers Orchestra', 'Partner Orchestra').replaceAll('ACO performs', 'Partner performs').replaceAll('ACO<strong> </strong>performs', 'Partner<strong> </strong>performs'), AT), /credit/);
  await assert.rejects((await parser(id)).scrape(cfg, body.replaceAll('<div>New York</div>', '<div>London</div>'), AT), /city/);
});
