import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { ScraperConfig } from '../src/schemas/config.js';
import { scrape as scrapeOcean } from '../src/engine/custom/artist-ocean-colour-scene.js';
import { scrape as scrapeKevin } from '../src/engine/custom/artist-puts-kevin.js';

test('Ocean Colour Scene and Kevin Puts extract source-specific country fields through runner', async () => {
  const html = {
    '/tour': `<article class="EventListingListItem"><a class="EventListingListItem-link" href="/events/2026-09-27-ocean-colour-scene-test"><div class="EventListingListItem-date"><span class="EventListingListItem-date-day">27</span><span class="EventListingListItem-date-month">Sep</span></div><span class="EventListingListItem-venue-room">Escenario Santander</span><span class="EventListingListItem-venue-city">Santander, ES</span></a></article>`,
    '/events': `<div class="schedule-text4_item"><div><h5 class="margin-vertical-0">October 4, 2026</h5></div><div><div class="small-text">The Soraya; Northridge, CA</div></div><a class="button" href="https://thesoraya.org/whats-on/en/the-colburn-orchestra/">see more</a></div>`
  };
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(html[request.url as keyof typeof html] ?? '');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const dir = await mkdtemp(join(tmpdir(), 'artist-ocean-kevin-test-'));
  try {
    const approved = join(dir, 'approved.json');
    await writeFile(approved, JSON.stringify([{ name: 'Ocean Colour Scene' }, { name: 'Puts, Kevin' }]));
    for (const [id, path, expected] of [
      ['artist-ocean-colour-scene', '/tour', { date: '2026-09-27', venue: 'Escenario Santander', city: 'Santander', country: 'ES' }],
      ['artist-puts-kevin', '/events', { date: '2026-10-04', venue: 'The Soraya', city: 'Northridge', country: 'US' }]
    ] as const) {
      const config = JSON.parse(await readFile(`scrapers/artists/${id}.json`, 'utf8')) as ScraperConfig;
      config.url = `http://localhost:${address.port}${path}`;
      config.domain = 'localhost';
      const result = await runScraper(config);
      assert.equal(result.success, true, `${id}: ${result.reason}`);
      assert.equal(result.concerts.length, 1);
      assert.deepEqual(
        (({ date, venue, city, country }) => ({ date, venue, city, country }))(result.concerts[0]),
        expected,
        id
      );
      assert.equal(result.concerts[0].ticketUrl,
        id === 'artist-ocean-colour-scene'
          ? `http://localhost:${address.port}/events/2026-09-27-ocean-colour-scene-test`
          : 'https://thesoraya.org/whats-on/en/the-colburn-orchestra/');
      const published = await processConcerts(result.concerts, approved, '2026-09-26T00:00:00.000Z');
      assert.equal(published.length, 1, `${id} must pass the unchanged pipeline`);
    }
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Kevin explicit multi-day dates retain their source year through processConcerts', async () => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-puts-kevin.json', 'utf8')) as ScraperConfig;
  const html = [
    `<div class="schedule-text4_item"><div><h5 class="margin-vertical-0">September 26 &amp; 27</h5><h5 class="margin-vertical-0">2026</h5></div><div class="small-text">Civic Center; Des Moines, IA</div><a class="button" href="https://www.desmoinesperformingarts.org/whats-on/events/2026-27/dm-symphony/season-debut-unity-american-mosaic-and-west-side-story">see more</a></div>`,
    `<div class="schedule-text4_item"><div><h5 class="margin-vertical-0">Nov 25, 27, 28 &amp; Dec 1</h5><h5 class="margin-vertical-0">2026</h5></div><div class="small-text">David Geffen Hall; New York, NY</div><a class="button" href="https://www.nyphil.org/concerts-tickets/2627/rouvali-conducts-schubert/">see more</a></div>`
  ].join('');
  const raw = await scrapeKevin(config, html, '2026-09-25T00:00:00.000Z');
  const dir = await mkdtemp(join(tmpdir(), 'artist-kevin-dates-'));
  try {
    const approved = join(dir, 'approved.json');
    await writeFile(approved, JSON.stringify([{ name: 'Puts, Kevin' }]));
    const currentPublished = await processConcerts(raw, approved, '2026-09-28T00:00:00.000Z');
    assert.equal(currentPublished.some(({ date }) => date === '2027-09-26'), false,
      'a past 2026 show must not be rolled into 2027');
    const published = await processConcerts(raw, approved, '2026-09-25T00:00:00.000Z');
    assert.deepEqual(published.map(({ date }) => date).sort(), [
      '2026-09-26', '2026-09-27', '2026-11-25', '2026-11-27', '2026-11-28', '2026-12-01'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ambiguous source fields remain incomplete instead of receiving a country or year guess', async () => {
  const oceanConfig = JSON.parse(await readFile('scrapers/artists/artist-ocean-colour-scene.json', 'utf8')) as ScraperConfig;
  const ocean = await scrapeOcean(oceanConfig, `<article class="EventListingListItem"><a class="EventListingListItem-link" href="/events/2027-09-27-example"><span class="EventListingListItem-date-day">28</span><span class="EventListingListItem-date-month">Sep</span><span class="EventListingListItem-venue-room">Hall</span><span class="EventListingListItem-venue-city">Mystery City</span></a></article>`, '2026-09-28T00:00:00.000Z');
  assert.equal(ocean.length, 1);
  assert.equal(ocean[0].date, undefined);
  assert.equal(ocean[0].country, undefined);

  const falseIso = await scrapeOcean(oceanConfig, `<article class="EventListingListItem"><a class="EventListingListItem-link" href="/events/2027-02-29-example"><span class="EventListingListItem-date-day">1</span><span class="EventListingListItem-date-month">Mar</span><span class="EventListingListItem-venue-room">Hall</span><span class="EventListingListItem-venue-city">Mystery City, ZZ</span></a></article>`, '2026-09-28T00:00:00.000Z');
  assert.equal(falseIso[0].date, undefined);
  assert.equal(falseIso[0].city, 'Mystery City');
  assert.equal(falseIso[0].country, undefined);

  const kevinConfig = JSON.parse(await readFile('scrapers/artists/artist-puts-kevin.json', 'utf8')) as ScraperConfig;
  const kevin = await scrapeKevin(kevinConfig, `<div class="schedule-text4_item"><h5 class="margin-vertical-0">March 6 and 7, 2027</h5><div class="small-text">Mt. Tam Methodist, Mill Valley, CA; Rodef Sholom, San Rafael, CA</div></div>`, '2026-09-28T00:00:00.000Z');
  assert.equal(kevin.length, 1);
  assert.equal(kevin[0].date, undefined);
  assert.equal(kevin[0].venue, undefined);
  assert.equal(kevin[0].country, undefined);

  const ranges = await scrapeKevin(kevinConfig, [
    `<div class="schedule-text4_item"><h5 class="margin-vertical-0">November 7 to 15, 2026</h5><div class="small-text">Atlanta Technology Center; Atlanta, GA</div></div>`,
    `<div class="schedule-text4_item"><h5 class="margin-vertical-0">March 8-April 3</h5><h5 class="margin-vertical-0">2027</h5><div class="small-text">New York, NY</div></div>`
  ].join(''), '2026-09-28T00:00:00.000Z');
  assert.deepEqual(ranges.map(({ date }) => date), [undefined, undefined]);

  const placeholder = await scrapeKevin(kevinConfig, `<div class="schedule-text4_item"><h5 class="margin-vertical-0">March 25, 2027</h5><div class="small-text">Staatsoper; Berlin, Germany</div><a class="button" href="#">see more</a></div>`, '2026-09-28T00:00:00.000Z');
  assert.equal(placeholder[0].country, 'DE');
  assert.equal(placeholder[0].ticketUrl, undefined);
});

test('Ocean canonicalizes only three verified venue labels in their exact city and country', async () => {
  const config = JSON.parse(await readFile('scrapers/artists/artist-ocean-colour-scene.json', 'utf8')) as ScraperConfig;
  const card = (venue: string, city: string, country: string) => `<article class="EventListingListItem"><a class="EventListingListItem-link" href="/events/2026-11-21-example"><span class="EventListingListItem-date-day">21</span><span class="EventListingListItem-date-month">Nov</span><span class="EventListingListItem-venue-room">${venue}</span><span class="EventListingListItem-venue-city">${city}, ${country}</span></a></article>`;
  const concerts = await scrapeOcean(config, [
    card('Glasgow OVO Hydro', 'Glasgow', 'GB'),
    card('Music Hall', 'Aberdeen', 'GB'),
    card('Alhambra', 'Dunfermline', 'GB'),
    card('Glasgow OVO Hydro', 'Aberdeen', 'GB'),
    card('Different Hall', 'Glasgow', 'GB'),
    card('Alhambra', 'Dunfermline', 'IE')
  ].join(''), '2026-09-28T00:00:00.000Z');
  assert.deepEqual(concerts.map(({ venue }) => venue), [
    'OVO Hydro', 'Aberdeen Music Hall', 'Alhambra Theatre',
    'Glasgow OVO Hydro', 'Different Hall', 'Alhambra'
  ]);
  assert.ok(concerts.every(({ startTime, lat, lng }) =>
    startTime === undefined && lat === undefined && lng === undefined));
});
