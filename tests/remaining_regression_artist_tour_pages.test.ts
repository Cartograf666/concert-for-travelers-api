import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { scrape as scrapeAlabama } from '../src/engine/custom/artist-alabama-3.js';
import { scrape as scrapeScotty } from '../src/engine/custom/artist-scotty-mccreery.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

const scrapedAt = '2026-10-06T12:00:00.000Z';
async function source(id: string) {
  return ScraperConfigSchema.parse(JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')));
}

test('Alabama 3 official current tour yields 20 explicit dates with GB and IE per row', async (t) => {
  const config = await source('artist-alabama-3');
  const html = await readFile('tests/fixtures/remaining_regression_alabama3.html', 'utf8');
  assert.equal(config.url, 'https://alabama3.co.uk/live/');
  assert.equal(config.allowEmpty, undefined);
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 20);
  assert.deepEqual([result.concerts[0].date, result.concerts[0].venue, result.concerts[0].city, result.concerts[0].country],
    ['2026-10-16', 'Thekla', 'Bristol', 'GB']);
  assert.deepEqual([result.concerts[15].date, result.concerts[15].city, result.concerts[15].country],
    ['2026-12-09', 'Dublin', 'IE']);
  assert.deepEqual([result.concerts[19].date, result.concerts[19].city, result.concerts[19].country],
    ['2026-12-13', 'Belfast', 'GB']);
  assert.ok(result.concerts.every(item => item.date! >= '2026-10-06'));
});

test('Alabama 3 keeps a new printed year and fails unknown geography or incomplete page', async (t) => {
  const config = await source('artist-alabama-3');
  const html = await readFile('tests/fixtures/remaining_regression_alabama3.html', 'utf8');
  const future = html.replace('datetime="2026-10-16"', 'datetime="2027-10-16"');
  assert.equal((await scrapeAlabama(config, future, scrapedAt))[0].date, '2027-10-16');
  await assert.rejects(scrapeAlabama(config, html.replace('Alabama 3 | Official Tour Dates', 'Another Band | Official Tour Dates'), scrapedAt), /official tour page is missing/);
  await assert.rejects(scrapeAlabama(config, html.replace('<h4>Bristol</h4>', '<h4>Unknown City</h4>'), scrapedAt), /unverified location/);
  await assert.rejects(scrapeAlabama(config, html.replace('datetime="2026-10-16"', 'datetime=""'), scrapedAt), /explicit ISO date/);
  const noRows = html.replaceAll('class="show"', 'class="not-show"');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: noRows, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'selectors_stale');
});

test('Scotty McCreery official current tour yields 10 fully dated US rows', async (t) => {
  const config = await source('artist-scotty-mccreery');
  const html = await readFile('tests/fixtures/remaining_regression_scotty_mccreery.html', 'utf8');
  assert.equal(config.url, 'https://www.scottymccreery.com/tour');
  assert.equal(config.allowEmpty, undefined);
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 10);
  assert.deepEqual([result.concerts[0].date, result.concerts[0].venue, result.concerts[0].city, result.concerts[0].country],
    ['2026-10-15', 'Hampton Beach Casino Ballroom', 'Hampton Beach', 'US']);
  assert.deepEqual([result.concerts[9].date, result.concerts[9].city, result.concerts[9].country],
    ['2026-12-05', 'Salisbury', 'US']);
});

test('Scotty uses printed future year, recognizes a Canadian province and rejects ambiguous rows', async (t) => {
  const config = await source('artist-scotty-mccreery');
  const html = await readFile('tests/fixtures/remaining_regression_scotty_mccreery.html', 'utf8');
  const future = html.replace('2026-10-15T00:00:00+00:00', '2027-10-15T00:00:00+00:00')
    .replace('Hampton Beach, NH', 'Toronto, ON');
  const first = (await scrapeScotty(config, future, scrapedAt))[0];
  assert.deepEqual([first.date, first.city, first.country], ['2027-10-15', 'Toronto', 'CA']);
  await assert.rejects(scrapeScotty(config, html.replace('Scotty McCreery Tour Dates', 'Another Artist Tour Dates'), scrapedAt), /official tour page is missing/);
  await assert.rejects(scrapeScotty(config, html.replace('Hampton Beach, NH', 'Unknown City, ZZ'), scrapedAt), /unverified location/);
  await assert.rejects(scrapeScotty(config, html.replace('Hampton Beach, NH', ', NH'), scrapedAt), /unverified location/);
  await assert.rejects(scrapeScotty(config, html.replace('2026-10-15T00:00:00+00:00', ''), scrapedAt), /explicit ISO date/);
  const noRows = html.replaceAll('class="event"', 'class="not-event"');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: noRows, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'selectors_stale');
});
