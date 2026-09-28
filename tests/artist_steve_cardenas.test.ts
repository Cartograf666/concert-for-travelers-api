import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-steve-cardenas.js';

const sourceConfig: ScraperConfig = {
  id: 'artist-steve-cardenas', domain: 'stevecardenasmusic.com',
  url: 'http://stevecardenasmusic.com/schedule/', type: 'custom_js'
};

function row(date: string, address = '163 West 10th Street, NYC', time = '8:00 pm') {
  return `<p>${date}<br>${time}<br>Steve Cardenas Trio<br>Mezzrow<br>${address}</p>`;
}

async function runFixture(t: test.TestContext, html: string) {
  const config = JSON.parse(await readFile('scrapers/artists/artist-steve-cardenas.json', 'utf8')) as ScraperConfig;
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return runScraper({ ...config, url: `http://127.0.0.1:${address.port}/schedule/` });
}

test('Steve Cardenas separates addresses and binds every concert to the explicit year', async (t) => {
  const html = await readFile('tests/fixtures/artist-steve-cardenas-schedule.html', 'utf8');
  const result = await runFixture(t, html);
  assert.equal(result.success, true);
  const january = result.concerts[0];
  assert.deepEqual(january && [january.date, january.city, january.country, january.startTime],
    ['2026-01-13', 'Brooklyn', 'US', '20:00']);
  assert.equal(january.venue, 'Bar Bayeux');
  assert.equal(result.concerts.length, 6, 'expand explicitly listed days, exclude the workshop');
  const canada = result.concerts.find((c) => c.country === 'CA');
  assert.deepEqual(canada && [canada.city, canada.date, canada.startTime], ['Montréal', '2026-06-25', undefined]);
  const spain = result.concerts.find((c) => c.venue === 'Teatro Central');
  assert.deepEqual(spain && [spain.city, spain.country, spain.startTime], ['Sevilla', 'ES', '20:30']);
  const dir = await mkdtemp(path.join(tmpdir(), 'steve-cardenas-test-'));
  const approved = path.join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify([{ name: 'Steve Cardenas' }]));
  const future = await processConcerts(result.concerts, approved, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(future.map((c) => c.date).sort(), ['2026-11-07', '2026-11-12', '2026-11-13', '2026-11-14']);
});

test('Steve Cardenas handles explicit ranges, year transitions and known address formats', async () => {
  const html = `<table><tr><td><h2>2026</h2>${row('December 30 – 31', '6171 West Century Blvd, Los Angeles, CA')}
    <h2>2027</h2>${row('January 1', 'Québec City, Québec, Canada', '12:00 pm')}
    ${row('January 2', 'Sevilla, Spain', '12:00 am')}</td></tr></table>`;
  const result = await scrape(sourceConfig, html, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(result.map((c) => [c.date, c.city, c.country, c.startTime]), [
    ['2026-12-30', 'Los Angeles', 'US', '20:00'],
    ['2026-12-31', 'Los Angeles', 'US', '20:00'],
    ['2027-01-01', 'Québec City', 'CA', '12:00'],
    ['2027-01-02', 'Sevilla', 'ES', '00:00']
  ]);
});

test('Steve Cardenas does not invent years, destinations or impossible dates', async () => {
  const html = `<table><tr><td>${row('January 2')}<h2>2026</h2>
    ${row('February 30')}${row('November 20 – 10')}${row('November 1 – 30')}
    ${row('November 7', 'Venue location TBA')}${row('November 7', 'Atlanta, Georgia')}
    <h2>Schedule TBA</h2>${row('November 8')}</td></tr></table>
    <table><tr><td>${row('November 9')}</td></tr></table>`;
  assert.deepEqual(await scrape(sourceConfig, html, '2026-09-28T00:00:00.000Z'), []);
});
