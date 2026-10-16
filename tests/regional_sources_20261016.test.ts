import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper } from '../src/engine/runner.js';
import { scrape as bravo } from '../src/engine/custom/bravo-tour.js';
import { scrape as vintazh } from '../src/engine/custom/vintazh-tour.js';
import { resetLlmFallbackBudget } from '../src/engine/llm_extraction_fallback.js';
import { processConcerts } from '../src/pipeline/process.js';

const at = '2026-10-16T18:55:11.000Z';
const config = (id: string) => ScraperConfigSchema.parse(JSON.parse(readFileSync(`scrapers/artists/${id}.json`, 'utf8')));
const fixture = (name: string) => readFileSync(`tests/fixtures/regional-20261016/${name}.html`, 'utf8');

test('Bravo native calendar separates exact venue and city through runner and current whitelist', async t => {
  t.mock.method(axios, 'get', async () => ({ status: 200, data: fixture('bravo'), headers: {} }));
  const result = await runScraper(config('bravo-tour'));
  assert.equal(result.success, true);
  assert.deepEqual(result.concerts.map(r => [r.city, r.venue]), [
    ['Москва', 'Atmosphere'], ['Санкт-Петербург', 'Aurora Concert Hall']
  ]);
  const accepted = await processConcerts(result.concerts, 'data/artists', at);
  assert.equal(accepted.length, 2);
  assert.deepEqual(accepted.map(r => r.date), ['2026-11-21', '2026-11-28']);
});

test('Bravo rejects absent calendar, missing year and unverified city', async () => {
  await assert.rejects(bravo(config('bravo-tour'), '<html></html>', at), /identity/);
  for (const html of [fixture('bravo').replaceAll('2026', ''), fixture('bravo').replaceAll('Москва', 'Неизвестно')]) {
    await assert.rejects(bravo(config('bravo-tour'), html, at), /unverified/);
  }
});

test('Vintazh uses ticket-evidenced years and withholds five yearless cards', async () => {
  const rows = await vintazh(config('vintazh-tour'), fixture('vintazh'), at);
  assert.deepEqual(rows.map(r => [r.date, r.city, r.venue]), [
    ['2026-10-23', 'Москва', 'GIPSY'], ['2026-08-30', 'Санкт-Петербург', 'ROOF PLACE']
  ]);
  const accepted = await processConcerts(rows, 'data/artists', at);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].date, '2026-10-23');
});

test('Vintazh never invents a year or accepts conflicting ticket dates', async () => {
  const html = fixture('vintazh');
  assert.deepEqual(await vintazh(config('vintazh-tour'), html.replaceAll('23102026', 'no-date').replaceAll('2026-08-30', 'no-date'), at), []);
  await assert.rejects(vintazh(config('vintazh-tour'), html.replaceAll('23102026', '24102026'), at), /disagree/);
  const $ = cheerio.load(html);
  const element = $('.tn-elem').filter((_, e) => $(e).text().replace(/\s+/g, '').includes('МОСКВАGIPSY')).first();
  element.html(element.html()!.replace('МОСКВА', 'НЕИЗВЕСТНО'));
  await assert.rejects(vintazh(config('vintazh-tour'), $.html(), at), /unverified location/);
  for (const location of ['КИПР', 'ТУРЦИЯ']) {
    const unknown = cheerio.load(html);
    const row = unknown('.tn-elem').filter((_, e) => unknown(e).text().replace(/\s+/g, '').includes('МОСКВАGIPSY')).first();
    row.html(location);
    await assert.rejects(vintazh(config('vintazh-tour'), unknown.html(), at), /no verified city/);
  }
});

test('Cafe del Mar only accepts zero after its visible explicit empty notice', async t => {
  const cafe = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/cafe-del-mar-bali.json', 'utf8')));
  let body = fixture('cafe-del-mar');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: body, headers: {} }));
  resetLlmFallbackBudget(0);
  t.after(() => resetLlmFallbackBudget());
  const result = await runScraper(cafe);
  assert.equal(result.success, true);
  assert.equal(result.reason, 'empty_schedule');
  assert.deepEqual(result.concerts, []);
  body = '<html><body>Calendar markup changed</body></html>';
  const changed = await runScraper(cafe);
  assert.equal(changed.success, false);
  assert.equal(changed.concerts.length, 0);
});
