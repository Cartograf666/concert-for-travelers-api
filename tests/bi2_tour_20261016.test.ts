import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper } from '../src/engine/runner.js';
import { scrape } from '../src/engine/custom/bi2-tour.js';
import { processConcerts } from '../src/pipeline/process.js';
const config = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/artists/bi2-tour.json', 'utf8')));
const html = readFileSync('tests/fixtures/regional-20261016/bi2.html', 'utf8');
const at = '2026-10-16T18:55:16.249Z';

test('Bi-2 native original yields seven concert tickets, no packages, with current whitelist', async t => {
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(config);
  assert.equal(result.success, true);
  assert.deepEqual(result.concerts.map(r => [r.city, r.country, r.date]), [
    ['Varna', 'BG', '2026-10-16'], ['Sofia', 'BG', '2026-10-18'], ['Budapest', 'HU', '2026-10-22'],
    ['Ljubljana', 'SI', '2026-10-26'], ['Zagreb', 'HR', '2026-10-28'],
    ['Geneva', 'CH', '2026-11-15'], ['Ludwigsburg', 'DE', '2026-11-17']
  ]);
  assert.equal(result.concerts.find(r => r.city === 'Belgrade' || r.city === 'Limassol'), undefined);
  assert.ok(result.concerts.every(r => r.artist === 'Би-2' && r.venue && r.ticketUrl?.startsWith('https://tix.bi2.band/events/bi2/')));
  const accepted = await processConcerts(result.concerts, 'data/artists', at);
  assert.equal(accepted.length, 7);
});

test('Bi-2 never turns a package-only catalog into live concert inventory', async () => {
  const $ = cheerio.load(html);
  $('.events-listing__item').filter((_, e) => $(e).find('.event__title').text().includes(' / Bi-2 in ')).remove();
  assert.deepEqual(await scrape(config, $.html(), at), []);
});

test('Bi-2 refuses wrong identity, unknown product, missing year, conflicting place and unsafe event URL', async () => {
  await assert.rejects(scrape(config, html.replace('id="tt-listings-title"', 'id="wrong"'), at), /identity/);
  const mutations: [($: cheerio.CheerioAPI) => void, RegExp][] = [
    [$ => { $('.event__title a').first().text('Unverified product'); }, /product/],
    [$ => { $('.event-meta__date var').eq(1).text(''); }, /full date/],
    [$ => { $('.event-meta__location').first().text('Other venue'); }, /country/],
    [$ => { $('.events-listing__item').eq(1).find('a.event__link').attr('href', 'https://unrelated.example/event'); }, /event URL/]
  ];
  for (const [mutate, message] of mutations) {
    const $ = cheerio.load(html);
    mutate($);
    await assert.rejects(scrape(config, $.html(), at), message);
  }
});
