import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/antoha-mc-tour.js';
import { runScraper } from '../src/engine/runner.js';

const config = ScraperConfigSchema.parse(JSON.parse(readFileSync(
  'scrapers/artists/antoha-mc-tour.json', 'utf8')));
const html = readFileSync('tests/fixtures/antoha-concerts-20261007.html', 'utf8');
const at = '2026-10-07T10:00:00.000Z';

test('official 2026 upcoming section has two film screenings and no live concerts', async t => {
  assert.equal(config.url, 'https://antoha-mc.ru/concerts');
  assert.equal(config.type, 'custom_js');
  assert.equal(config.allowEmpty, true);
  assert.deepEqual(await scrape(config, html, at), []);

  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const previous = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  t.after(() => { if (previous === undefined) delete process.env.SCRAPER_HTTP_BACKEND; else process.env.SCRAPER_HTTP_BACKEND = previous; });
  const result = await runScraper(config);
  assert.equal(result.success, true);
  assert.equal(result.reason, 'empty_schedule');
  assert.deepEqual(result.concerts, []);
});

test('a real upcoming Moscow show uses the visible year, venue, city and ticket', async () => {
  const $ = cheerio.load(html);
  const card = $('#rec4099449101');
  card.find('[data-elem-id="1762508321263"] .tn-atom').text('16 тонн');
  card.find('a.tn-atom').attr('href', 'https://tickets.example/antoha-ms-moscow');
  const rows = await scrape(config, $.html(), at);
  assert.deepEqual(rows, [{
    artist: 'Антоха МС', date: '2026-10-15', venue: '16 тонн',
    city: 'Москва', country: 'RU', ticketUrl: 'https://tickets.example/antoha-ms-moscow',
    originalSource: 'antoha-mc.ru', scrapedAt: at
  }]);
});

test('missing boundary, stale dates and unknown future cities never become a healthy empty calendar', async () => {
  await assert.rejects(scrape(config, html.replace('прошедшие', ''), at), /contains a past date|incomplete/);
  await assert.rejects(scrape(config, html, '2026-10-18T10:00:00.000Z'), /contains a past date/);
  const $ = cheerio.load(html);
  const card = $('#rec4099449101');
  card.find('[data-elem-id="1762508321263"] .tn-atom').text('Клуб');
  card.find('[data-elem-id="1762508321260"] .tn-atom').text('Неизвестный город');
  await assert.rejects(scrape(config, $.html(), at), /unverified city/);
  card.find('[data-elem-id="1762508321263"] .tn-atom').text('кинопоказ каро/арт');
  card.find('a.tn-atom').attr('href', 'https://tickets.example/not-a-cinema');
  await assert.rejects(scrape(config, $.html(), at), /screening label and ticket do not agree/);
  card.find('[data-elem-id="1762508321263"] .tn-atom').text('кинопоказ другой');
  await assert.rejects(scrape(config, $.html(), at), /event type is unverified/);
});
