import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { runScraper, resetDomainCircuit, scraperCacheFingerprint } from '../src/engine/runner.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { processConcerts } from '../src/pipeline/process.js';
import { programmeUrls, parseProgramme } from '../src/engine/custom/artist-rhode-island-philharmonic-orchestra.js';
import type { VenueCache } from '../src/engine/cache.js';

const at = '2026-10-11T00:00:00.000Z';
const fixture = (id: string) => readFileSync(`tests/fixtures/riphil-20261011/${id}.json`, 'utf8');
const config = () => ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/artist-rhode-island-philharmonic-orchestra.json', 'utf8')));
const aliases = ['sep26', 'oct26', 'nov26', 'dec26', 'jan27', 'feb27', 'mar27', 'apr27', 'may27'];
const dates: [string, string | undefined][] = [
  ['2026-09-19', '19:30'], ['2026-10-16', '18:30'], ['2026-10-17', '19:30'],
  ['2026-11-20', '18:30'], ['2026-11-21', '19:30'], ['2026-12-13', undefined],
  ['2027-01-23', '19:30'], ['2027-02-12', '18:30'], ['2027-02-13', '19:30'],
  ['2027-03-13', '19:30'], ['2027-04-09', '18:30'], ['2027-04-10', '19:30'], ['2027-05-01', '19:30']
];

function altered(id: string, change: ($: cheerio.CheerioAPI) => void) {
  const native = JSON.parse(fixture(id)); const $ = cheerio.load(native.content); change($);
  return JSON.stringify({ ...native, content: $.html() });
}

test('Riphil full nine-programme native season -> stock runner -> real pipeline preserves complete concert records', async t => {
  const c = config(); const requested: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    requested.push(url);
    const id = url === c.url ? 'season' : new URL(url).pathname.slice(1);
    assert.ok(id === 'season' || aliases.includes(id), `unexpected/unverified source URL ${url}`);
    return { status: 200, data: fixture(id), headers: {} };
  });
  const result = await runScraper(c); assert.equal(result.success, true, result.error);
  assert.deepEqual(requested, [c.url, ...aliases.map(alias => `https://www.riphil.org/${alias}`)]);
  assert.deepEqual(result.concerts.map(row => [row.date, row.startTime]), dates);
  for (const row of result.concerts) {
    assert.equal(row.artist, 'Rhode Island Philharmonic Orchestra'); assert.equal(row.venue, 'The VETS');
    assert.equal(row.city, 'Providence'); assert.equal(row.country, 'US'); assert.equal(row.originalSource, 'riphil.org');
    assert.ok(aliases.some(alias => row.ticketUrl === `https://www.riphil.org/${alias}`));
  }
  const original = structuredClone(result.concerts);
  const publicRows = await processConcerts(result.concerts, 'data/artists', at);
  assert.equal(publicRows.length, 12, 'only the September concert is past; no verified future concert is dropped');
  assert.deepEqual(publicRows.map(row => [row.date, row.startTime]), dates.slice(1));
  assert.ok(publicRows.every(row => row.artist === 'Rhode Island Philharmonic Orchestra' && row.venue === 'The VETS' && row.city === 'Providence' && row.country === 'US'));
  assert.equal(new Set(publicRows.map(row => row.mbid)).size, 1);
  assert.equal(publicRows[0].mbid, undefined, 'actual approved orchestra has no MBID; never invent one');
  assert.ok(publicRows.every(row => row.artistWebsite === 'https://riphil.org/' && row.artistSocials?.instagram === 'https://www.instagram.com/riphilharmonic/'));
  assert.deepEqual(result.concerts, original, 'source rows/cache are never rewritten by processing');
});

test('all nine native details exclude open rehearsals and retain explicitly credited orchestra rather than composers/guest aliases', () => {
  const c = config();
  const rows = aliases.flatMap(alias => parseProgramme(c, fixture(alias), `https://www.riphil.org/${alias}`, at));
  assert.equal(rows.length, 13);
  for (const date of ['2026-09-18', '2027-01-22', '2027-03-12', '2027-04-30']) assert.ok(!rows.some(row => row.date === date), `open rehearsal ${date} is not a concert`);
  assert.ok(rows.every(row => row.artist === 'Rhode Island Philharmonic Orchestra'));
  assert.deepEqual(rows.map(row => [row.date, row.startTime]), dates);
});

test('missing or inaccessible any one programme fails the whole stock run, with no partial or invented empty success', async t => {
  const c = config();
  const cache: VenueCache = { scrapedAt: at, verifiedAt: at, contentHash: 'last-good',
    cacheFingerprint: await scraperCacheFingerprint(c),
    concerts: parseProgramme(c, fixture('oct26'), 'https://www.riphil.org/oct26', at) };
  const priorCache = structuredClone(cache);
  for (const failed of aliases) {
    resetDomainCircuit(c.domain);
    t.mock.method(axios, 'get', async (url: string) => {
      const id = url === c.url ? 'season' : new URL(url).pathname.slice(1);
      if (id === failed) {
        const error = new Error('Request failed with status code 403') as Error & { response: { status: number } };
        error.response = { status: 403 }; throw error;
      }
      return { status: 200, data: fixture(id), headers: {} };
    });
    const result = await runScraper(c, cache);
    assert.deepEqual(cache, priorCache, 'failed linked request must not clear last-good data or advance verifiedAt');
    assert.equal(result.success, false, failed); assert.equal(result.concerts.length, 0);
    assert.match(result.error!, /403/);
    t.mock.restoreAll();
  }
  const noNav = JSON.parse(fixture('season')); noNav.extensionsToRender = {};
  assert.throws(() => programmeUrls(c, JSON.stringify(noNav)), /navigation incomplete/);
  const noTitle = altered('season', $ => $('[id="1898856927"]').remove());
  assert.throws(() => programmeUrls(c, noTitle), /season identity/);
});

test('printed full year, weekday, programme, orchestra and native place must agree; no date/venue/year fallback', () => {
  const c = config(); const url = 'https://www.riphil.org/oct26';
  for (const [label, body] of [
    ['missing year', altered('oct26', $ => $('[id="1887927626"] p').eq(1).text('October 16 - 17'))],
    ['wrong year', altered('oct26', $ => $('[id="1887927626"] p').eq(1).text('October 16 - 17, 2028'))],
    ['unknown place', altered('oct26', $ => $('[id="1887927626"] p').eq(2).text('Unknown Hall, New City'))],
    ['uncredited orchestra', altered('oct26', $ => $('[id="1678221425"]').text('Performing Artists Other Orchestra'))]
  ]) assert.throws(() => parseProgramme(c, body, url, at), /unverified/, label);
  const wrongSlot = altered('oct26', $ => $('[id="1719886704"]').html($('[id="1719886704"]').html()!.replace('Friday, October 16', 'Thursday, October 16')));
  assert.throws(() => parseProgramme(c, wrongSlot, url, at), /does not agree/);
  const noConcerts = altered('oct26', $ => $('[id="1719886704"] p').remove());
  assert.throws(() => parseProgramme(c, noConcerts, url, at), /date coverage incomplete/);
  const oneSlotMissing = altered('oct26', $ => $('[id="1719886704"] p').first().remove());
  assert.throws(() => parseProgramme(c, oneSlotMissing, url, at), /date coverage incomplete/);
  const changedSingle = altered('dec26', $ => $('[id="1887927626"] p').first().text('Open rehearsal'));
  assert.throws(() => parseProgramme(c, changedSingle, 'https://www.riphil.org/dec26', at), /no verified concert slots/);
});

test('unchanged season shell cannot skip fresh linked programmes via conditional-cache reuse', async t => {
  const c = config(); assert.equal(c.skipConditionalRequests, true);
  const cache: VenueCache = { scrapedAt: at, contentHash: 'old', concerts: [],
    cacheFingerprint: await scraperCacheFingerprint(c), etag: 'unchanged-shell' };
  let calls = 0;
  t.mock.method(axios, 'get', async (url: string, options: { headers: Record<string, string> }) => {
    calls++; assert.equal(options.headers['If-None-Match'], undefined);
    const id = url === c.url ? 'season' : new URL(url).pathname.slice(1);
    return { status: 200, data: fixture(id), headers: {} };
  });
  resetDomainCircuit(c.domain); const result = await runScraper(c, cache);
  assert.equal(result.success, true, result.error); assert.equal(result.concerts.length, 13); assert.equal(calls, 10);
});
