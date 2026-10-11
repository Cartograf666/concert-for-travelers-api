import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { runScraper, resetDomainCircuit } from '../src/engine/runner.js';
import { resetLlmFallbackBudget } from '../src/engine/llm_extraction_fallback.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { processConcerts } from '../src/pipeline/process.js';
import { scrape as timmons } from '../src/engine/custom/artist-andy-timmons.js';
import { scrape as ellen } from '../src/engine/custom/artist-ellen-ten-damme.js';
import { scrape as billy } from '../src/engine/custom/artist-billy-bragg.js';
import type { Concert } from '../src/schemas/concert.js';
const at = '2026-10-11T00:00:00.000Z';
const fixture = (id: string) => readFileSync(`tests/fixtures/fleet-recovery-20261011/${id}.html`, 'utf8');
const config = (id: string) => ScraperConfigSchema.parse(JSON.parse(readFileSync(`scrapers/${id === 'kitty-su-bangalore' ? '' : 'artists/'}${id}.json`, 'utf8')));
const fields = (r: Partial<Concert>) => [r.artist, r.date, r.venue, r.city, r.country, r.ticketUrl];

async function publish(rows: Partial<Concert>[]) {
  return processConcerts(rows, 'data/artists', at);
}

test('Andy Timmons paired native calendar fixes selector failure and publishes the complete identity', async t => {
  const html = fixture('artist-andy-timmons'); const c = config('artist-andy-timmons');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(c);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(result.concerts.map(fields), [[ 'Andy Timmons', '2026-11-13', 'Guitar Sanctuary', 'McKinney, TX', 'United States', 'https://embed.leapevents.com/event/AndyTimmonsNocturnes/pre-sale' ]]);
  const before = structuredClone(result.concerts); const publicRows = await publish(result.concerts);
  assert.equal(publicRows.length, 1); assert.equal(publicRows[0].artist, 'Andy Timmons'); assert.equal(publicRows[0].country, 'US');
  assert.deepEqual(result.concerts, before);
  await assert.rejects(timmons(c, html.replace('20261113T200000Z', '20271113T200000Z'), at), /mismatch/);
  await assert.rejects(timmons(c, html.replace('United States', ''), at), /incomplete native location/);
  await assert.rejects(timmons(c, html.replace('Shows - Andy Timmons', 'Shows - Other Artist'), at), /identity/);
});

test('Ellen current native tour including Spaarndam retains all 62 records through runner and pipeline', async t => {
  const html = fixture('artist-ellen-ten-damme'); const c = config('artist-ellen-ten-damme');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(c); assert.equal(result.success, true, result.error); assert.equal(result.concerts.length, 62);
  const row = result.concerts.find(r => r.city === 'Spaarndam');
  assert.deepEqual(fields(row!), ['Ellen ten Damme', '2026-11-12', 'El Theatro', 'Spaarndam', 'NL', 'https://shop.ikbenaanwezig.nl/tickets/event/ellen-ten-damme-medusa-try-out']);
  const publicRows = await publish(result.concerts); assert.equal(publicRows.length, 62); assert.ok(publicRows.every(r => r.artist === 'Ellen ten Damme'));
  await assert.rejects(ellen(c, html.replace('> Spaarndam</a>', '> Unknown City</a>'), at), /unverified country/);
});

test('Billy actual giglist replaces album page; countries and range ambiguity survive real pipeline', async t => {
  const html = fixture('artist-billy-bragg'); const c = config('artist-billy-bragg');
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  const result = await runScraper(c); assert.equal(result.success, true, result.error); assert.equal(result.concerts.length, 18);
  assert.deepEqual(fields(result.concerts[0]), ['Billy Bragg', '12 nov 2026', 'OVO Hydro', 'Glasgow', 'GB', 'https://www.billybragg.co.uk/js_events/ovo-hydro-glasgow/']);
  assert.deepEqual(fields(result.concerts[17]), ['Billy Bragg', '15 may 2027', 'Shelter From The Storm', 'Aalborg', 'DK', 'https://www.billybragg.co.uk/js_events/shelter-from-the-storm/']);
  assert.ok(!result.concerts.some(row => row.city === 'Vitoria - Gasteiz'), 'festival interval is not a verified performance date');
  const publicRows = await publish(result.concerts); assert.equal(publicRows.length, 18); assert.ok(publicRows.every(r => r.artist === 'Billy Bragg')); assert.ok(!publicRows.some(r => r.city === 'Vitoria - Gasteiz'));
  const changedCity = cheerio.load(html); changedCity('.event_list_title').first().text('OVO Hydro – Unknown City');
  await assert.rejects(billy(c, changedCity.html(), at), /unverified native location/);
  const changedYear = cheerio.load(html); changedYear('.eventlist_year').first().text('2028');
  await assert.rejects(billy(c, changedYear.html(), at), /unverified native location/);
});


for (const id of ['artist-andy-cairns', 'artist-eskimo-joe']) {
  test(`${id}: only the visible native empty notice accepts zero; missing or hidden notices fail`, async t => {
    resetLlmFallbackBudget(0); const c = config(id); let html = fixture(id);
    t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
    let result = await runScraper(c); assert.equal(result.success, true); assert.equal(result.reason, 'empty_schedule');
    html = html.replaceAll(c.emptyScheduleText!, 'Schedule unavailable'); resetDomainCircuit(c.domain);
    result = await runScraper(c); assert.equal(result.success, false);
    html += `<span style="display:none">${c.emptyScheduleText}</span>`; resetDomainCircuit(c.domain);
    result = await runScraper(c); assert.equal(result.success, false);
  });
}
