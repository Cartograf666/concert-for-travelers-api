import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-hue-cry.js';

async function runFixture(t: test.TestContext, html: string) {
  const config = JSON.parse(await readFile('scrapers/artists/artist-hue-cry.json', 'utf8')) as ScraperConfig;
  // Exercise the real configured parser without contacting the official site.
  t.mock.method(axios, 'get', async () => ({ status: 200, data: html, headers: {} }));
  return runScraper(config);
}

test('Hue & Cry official rows retain section years and publish clean locations', async (t) => {
  const html = await readFile('tests/fixtures/artist-hue-cry-live.html', 'utf8');
  const result = await runFixture(t, html);
  assert.equal(result.success, true);
  assert.equal(result.concerts.length, 14);
  const dir = await mkdtemp(path.join(tmpdir(), 'hue-cry-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const approved = path.join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify([{ name: 'Hue & Cry' }]));
  const published = await processConcerts(result.concerts, approved, '2026-09-27T15:01:41.892Z');
  assert.equal(published.length, 14, 'all official rows must survive strict pipeline validation');
  assert.deepEqual(published.map(({ date, city, venue, country }) => ({ date, city, venue, country })), [
    ['2026-10-09', 'MANCHESTER', 'BRIDGEWATER HALL'],
    ['2026-10-10', 'LONDON', 'INDIGO AT THE O2'],
    ['2026-10-11', 'CAMBRIDGE', 'CORN EXCHANGE'],
    ['2026-10-16', 'BIRMINGHAM', 'SYMPHONY HALL'],
    ['2026-10-17', 'GATESHEAD', 'ICM GLASSHOUSE SAGE 1'],
    ['2026-10-22', 'INVERNESS', 'EDEN COURT'],
    ['2026-10-23', 'ABERDEEN', 'MUSIC HALL'],
    ['2026-10-24', 'EDINBURGH', 'USHER HALL'],
    ['2026-10-30', 'GLASGOW', 'ROYAL CONCERT HALL'],
    ['2026-10-31', 'PERTH', 'CONCERT HALL'],
    ['2026-11-13', 'HESWALL', 'HESWALL HALL'],
    ['2027-04-04', 'CARLISLE', 'OLD FIRE STATION'],
    ['2027-06-17', 'CHESTER', 'ALEXANDER’S LIVE'],
    ['2027-06-18', 'PENTYRCH', 'ACAPELA STUDIOS']
  ].map(([date, city, venue]) => ({ date, city, venue, country: 'GB' })));
  assert.equal(result.concerts[0].ticketUrl, 'https://www.ticketmaster.co.uk/hue-and-cry-roachford-manchester-09-10-2026/event/1F00634ED2618313');
  assert.equal(result.concerts[13].ticketUrl, 'https://acapela.co.uk/events/hue-and-cry-acoustic-duo-2027/');
});

test('Hue & Cry rejects unknown, absent or conflicting regions and missing year context', async () => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-hue-cry.json', 'utf8')) as ScraperConfig;
  const row = (line: string) => `<p class="wp-block-paragraph"><strong>${line}<br>Electro / Acoustic</strong></p>`;
  const html = `<div class="entry-content">
    ${row('09 October | MANCHESTER, BRIDGEWATER HALL (ENG)')}
    <h2>2026</h2>
    ${row('09 October | MANCHESTER, BRIDGEWATER HALL (USA)')}
    ${row('09 October | MANCHESTER, BRIDGEWATER HALL')}
    ${row('09 October | MANCHESTER, BRIDGEWATER HALL (ENG) (SCT)')}
    ${row('31 February | MANCHESTER, BRIDGEWATER HALL (ENG)')}
    <h3>Archive</h3>
    ${row('09 October | MANCHESTER, BRIDGEWATER HALL (ENG)')}
    <h3>2027</h3>
    ${row('18 June | PENTYRCH, ACAPELA STUDIOS (WLS)')}
  </div>`;
  const concerts = await scrape(config, html, '2026-09-27T15:01:41.892Z');
  assert.equal(concerts.length, 1, 'the GB fallback cannot rescue unsupported or ambiguous rows');
  assert.equal(concerts[0].date, '2027-06-18');
  assert.equal(concerts[0].country, 'GB');
});

test('Hue & Cry preserves safe relative ticket links and discards unsafe schemes', async () => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-hue-cry.json', 'utf8')) as ScraperConfig;
  const html = `<div class="entry-content"><h2>2027</h2>
    <p class="wp-block-paragraph"><strong>04 April | CARLISLE, OLD FIRE STATION (ENG)<br>Acoustic</strong><a href="/tickets/carlisle">Tickets</a></p>
    <p class="wp-block-paragraph"><strong>18 June | PENTYRCH, ACAPELA STUDIOS (WLS)<br>Acoustic</strong><a href="javascript:alert(1)">Tickets</a></p>
  </div>`;
  const concerts = await scrape(config, html, '2026-09-27T15:01:41.892Z');
  assert.equal(concerts.length, 2);
  assert.equal(concerts[0].ticketUrl, 'https://hueandcry.co.uk/tickets/carlisle');
  assert.equal(concerts[1].ticketUrl, undefined);
});
