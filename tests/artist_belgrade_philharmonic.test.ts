import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import type { ScraperConfig } from '../src/schemas/config.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-belgrade-philharmonic-orchestra.js';
import { runScraper } from '../src/engine/runner.js';

const SEASON_URL = 'https://www.bgf.rs/en/kategorije-repertoar/concert-season-26-27/';
const SCRAPED_AT = '2026-09-28T06:00:00.000Z';
const dates = '2026-10-09 2026-11-06 2026-11-20 2026-11-27 2026-12-04 2026-12-11 2026-12-18 2027-01-15 2027-01-22 2027-01-29 2027-02-05 2027-02-12 2027-02-26 2027-03-05 2027-03-12 2027-03-19 2027-04-09 2027-04-16 2027-04-23 2027-05-07 2027-05-14 2027-05-21 2027-05-28 2027-06-04 2027-06-11'.split(' ');

async function config(): Promise<ScraperConfig> {
  return ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artist-belgrade-philharmonic-orchestra.json', 'utf8')));
}

function page(cards: string, canonical = SEASON_URL): string {
  return `<html><head><link rel="canonical" href="${canonical}"></head><body class="term-concert-season-26-27"><section id="cd-timeline">${cards}</section><a href="https://www.bgf.rs/en/buy-tickets/">Tickets</a></body></html>`;
}

function card(date = '9.10.2026.', time = '20:00', venue = 'Grand Hall of the Kolarac Foundation', title = 'Programme'): string {
  return `<article class="timeline-post"><span class="repertoire-date"><p>${date}</p></span><span class="repertoire-time"><p>${time}</p></span><div class="other-info"><h4><a href="https://www.bgf.rs/en/repertoar_cp/programme/">${title}</a></h4><div class="repertoire-conductor"><a href="https://www.bgf.rs/en/dirigent_cp/conductor/">Conductor</a></div><span class="repertoire-place"><p>${venue}</p></span></div></article>`;
}

test('official season fixture yields the exact 25 dated orchestra rows without programme or navigation ticket links', async () => {
  const cfg = await config();
  const html = await readFile('tests/fixtures/artist-belgrade-season-20260928.html', 'utf8');
  assert.equal(cfg.type, 'custom_js');
  assert.equal(cfg.httpClient, 'got-scraping');
  assert.equal(cfg.url, SEASON_URL);
  const rows = await scrape(cfg, html, SCRAPED_AT);
  assert.deepEqual(rows.map(row => row.date), dates);
  for (const row of rows) {
    assert.equal(row.artist, 'Belgrade Philharmonic Orchestra');
    assert.equal(row.startTime, '20:00');
    assert.equal(row.venue, 'Grand Hall of the Kolarac Foundation');
    assert.equal(row.city, 'Belgrade');
    assert.equal(row.country, 'RS');
    assert.equal(row.ticketUrl, undefined);
    assert.equal(row.originalSource, 'www.bgf.rs');
  }
});

test('real runner dispatches the configured custom parser against the captured page', async (t) => {
  const cfg = await config();
  const html = await readFile('tests/fixtures/artist-belgrade-season-20260928.html', 'utf8');
  t.mock.timers.enable({ apis: ['Date'], now: new Date(SCRAPED_AT) });
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const previous = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios'; // Exercise the parser dispatch without a production request.
  t.after(() => { if (previous === undefined) delete process.env.SCRAPER_HTTP_BACKEND; else process.env.SCRAPER_HTTP_BACKEND = previous; });
  const result = await runScraper(cfg);
  assert.equal(result.success, true);
  assert.deepEqual(result.concerts.map(row => row.date), dates);
});

test('rejects foreign pages and invalid scrape instants', async () => {
  const cfg = await config();
  assert.deepEqual(await scrape(cfg, page(card(), 'https://www.bgf.rs/en/concerts/'), SCRAPED_AT), []);
  assert.deepEqual(await scrape({ ...cfg, url: 'https://www.bgf.rs/en/concerts/' }, page(card()), SCRAPED_AT), []);
  assert.deepEqual(await scrape(cfg, page(card()).replace('term-concert-season-26-27', 'other-page'), SCRAPED_AT), []);
  assert.deepEqual(await scrape(cfg, page(card()), 'not-a-date'), []);
});

test('requires explicit valid future date, time, place and one programme link per card', async () => {
  const cfg = await config();
  const invalid = [
    card('9.10.', '20:00'), card('31.2.2027.'), card('9.10.2025.'),
    card('9.10.2026.', '25:00'), card('9.10.2026.', ''),
    card('9.10.2026.', '20:00', ''), card('9.10.2026.', '20:00', 'Moved venue'),
    card().replace('</article>', '<span class="repertoire-date">10.10.2026.</span></article>'),
    card().replace('</article>', '<span class="repertoire-time">21:00</span></article>'),
    card().replace('</article>', '<span class="repertoire-place">Other hall</span></article>'),
    card().replace('</h4>', '<a href="https://www.bgf.rs/en/repertoar_cp/other/">Other programme</a></h4>'),
    card().replace('>Programme</a>', '>Cancelled</a>'),
    card().replace('>Programme</a>', '>Postponed</a>')
  ];
  for (const [index, row] of invalid.entries()) assert.deepEqual(await scrape(cfg, page(row), SCRAPED_AT), [], `invalid card ${index}`);
  assert.deepEqual(await scrape(cfg, page(`<div class="cd-timeline-block postponed">${card()}</div>`), SCRAPED_AT), []);
  assert.deepEqual(await scrape(cfg, page(`<div class="cd-timeline-block"><span>Cancelled</span>${card()}</div>`), SCRAPED_AT), []);
  const valid = await scrape(cfg, page(card()), '2026-10-08T22:30:00.000Z');
  assert.equal(valid.length, 1, 'local Belgrade date is 9 October');
  assert.deepEqual(await scrape(cfg, page(card()), '2026-10-09T22:30:00.000Z'), [], 'local date is already 10 October');
});

test('deduplicates identical cards and holds conflicting same-day programmes', async () => {
  const cfg = await config();
  assert.equal((await scrape(cfg, page(card() + card()), SCRAPED_AT)).length, 1);
  assert.deepEqual(await scrape(cfg, page(card() + card('9.10.2026.', '20:00', 'Grand Hall of the Kolarac Foundation', 'Another programme')), SCRAPED_AT), []);
  assert.deepEqual(await scrape(cfg, page(card() + card().replace('/repertoar_cp/programme/', '/repertoar_cp/other/')), SCRAPED_AT), []);
});
