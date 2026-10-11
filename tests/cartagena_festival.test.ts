import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { scrape } from '../src/engine/custom/cartagena-festival-de-musica-cartagena.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import axios from 'axios';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';

async function context(all = false) {
  const config = ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/cartagena-festival-de-musica-cartagena.json', 'utf8')));
  const fixture = JSON.parse(await readFile('tests/fixtures/cartagena-native-20261007.json', 'utf8')) as {
    indexHtml: string; details: Record<string, string>; excludedIndices: number[];
  };
  const $ = cheerio.load(fixture.indexHtml);
  if (!all) $('.mkdf-event-list-item').each((index, el) => { if (![0, 2, 36].includes(index)) $(el).remove(); });
  const fetch = async (url: string) => {
    assert.ok(Object.hasOwn(fixture.details, url), `Only linked native details may be fetched: ${url}`);
    return fixture.details[url];
  };
  return { config, fixture, indexHtml: $.html(), fetch };
}
const NOW = '2026-10-10T10:54:07.538Z';

test('all 42 native cards yield complete performers, dates and venues with explicit nonconcert exclusions', async () => {
  const { config, fixture, indexHtml, fetch } = await context(true);
  assert.equal(config.type, 'custom_js');
  assert.equal(config.skipConditionalRequests, true);
  assert.notEqual(config.allowEmpty, true);
  const rows = await scrape(config, indexHtml, NOW, fetch);
  assert.equal(rows.length, 78);
  assert.equal(new Set(rows.map(row => row.sourceEventUrl)).size, 37);
  const urls = Object.keys(fixture.details);
  assert.equal(rows.find(row => row.sourceEventUrl === urls[1])?.artist, 'Giovanni Bietti',
    'Ambiguous opening-session classification must not suppress native raw performers');
  for (const index of fixture.excludedIndices.filter(index => index !== 1)) assert.ok(!rows.some(row => row.sourceEventUrl === urls[index]));
  assert.deepEqual([25, 29].map(index => rows.filter(row => row.sourceEventUrl === urls[index]).map(row => row.artist)), [
    ['Enrico Dindo', 'Monica Cattarossi'], ['Elena Bashkirova']
  ], 'Native live performance details outrank the ambiguous conversatorios CSS category');
  assert.ok(rows.some(row => row.sourceEventUrl === urls[39]), 'Explicit hybrid neuro concierto-conferencia retains live performance');
  assert.ok(rows.every(row => row.artist && row.date && row.startTime && row.venue && row.country === 'CO'));
  assert.ok(rows.every(row => row.lat === undefined && row.lng === undefined));
  assert.equal(rows.find(row => row.sourceEventUrl === urls[12])?.venue, 'Teatro Adolfo Mejía', 'Native detail venue outranks conflicting listing');
});

test('programme title and repertoire composers never become billed performers', async () => {
  const { config, indexHtml, fetch } = await context();
  const rows = await scrape(config, indexHtml, NOW, fetch);
  const row = rows.filter(row => row.sourceEventUrl?.includes('la-intuicion-del-siglo-xx'));
  assert.deepEqual(row.map(r => [r.artist, r.date, r.startTime, r.venue, r.city]), [
    ['Natalie Tenenbaum', '2027-01-16', '16:00', 'Palacio de la Proclamación', 'Cartagena']
  ]);
  assert.ok(!rows.some(r => /Siglo XX|Michael Jackson|Chris Isaak|Bach|Debussy/.test(r.artist!)));
  assert.deepEqual(rows.filter(r => r.city === 'Bogotá').map(r => r.date), Array(4).fill('2026-10-17'));
  assert.ok(rows.some(r => r.artist === 'English Chamber Orchestra' && r.venue === 'Teatro Adolfo Mejía'));
});

test('missing native performers, venue, full date or invalid time fails the entire source', async () => {
  const { config, indexHtml, fixture } = await context();
  const url = Object.keys(fixture.details)[36];
  for (const mutate of [
    (html: string) => html.replace('>ARTISTAS<', '>UNKNOWN<'),
    (html: string) => html.replace('>ESCENARIO<', '>UNKNOWN<'),
    (html: string) => html.replace('16 de enero de 2027', '16 de enero'),
    (html: string) => html.replace('16 de enero de 2027', '32 de enero de 2027'),
    (html: string) => html.replace('16 de enero de 2027', '17 de enero de 2027'),
    (html: string) => html.replace('16 de enero de 2027', '16 de febrero de 2027'),
    (html: string) => html.replace('16 de enero de 2027', '16 de enero de 2028'),
    (html: string) => html.replace('4:00 p.m.', '25:00 p.m.')
  ]) {
    assert.notEqual(mutate(fixture.details[url]), fixture.details[url]);
    await assert.rejects(scrape(config, indexHtml, NOW, async target => target === url ? mutate(fixture.details[target]) : fixture.details[target]), /Cartagena/);
  }
  await assert.rejects(scrape(config, indexHtml, NOW, async () => { throw new Error('detail access failed'); }), /detail access failed/);
  await assert.rejects(scrape(config, '<html><head><title>Blocked</title></head></html>', NOW), /identity missing/);
});

test('external or unexpected detail and artist links are rejected without external requests', async () => {
  const { config, indexHtml, fixture } = await context();
  for (const url of ['https://evil.example/show-item/fake/', 'https://cartagenamusicfestival.com:8443/show-item/fake/', 'http://127.0.0.1/show-item/fake/']) {
    const $ = cheerio.load(indexHtml);
    $('.mkdf-btn-outline').first().attr('href', url);
    await assert.rejects(scrape(config, $.html(), NOW, async () => { throw new Error('Unexpected request'); }), /unsafe native/);
  }
  const url = Object.keys(fixture.details)[36];
  await assert.rejects(scrape(config, indexHtml, NOW, async target => target === url
    ? fixture.details[target].replace('https://cartagenamusicfestival.com/artistas/natalie-tenenbaum/', 'https://evil.example/artistas/natalie-tenenbaum/')
    : fixture.details[target]), /unsafe native artistas/);
});


test('stock runner native replay preserves nine actual-catalogue concerts and rejects old title/fuzzy identities', async t => {
  const { config, fixture, indexHtml } = await context(true);
  t.mock.method(axios, 'get', async (url: string) => {
    assert.ok(url === config.url || Object.hasOwn(fixture.details, url), `Only captured official pages may be requested: ${url}`);
    return { status: 200, data: url === config.url ? indexHtml : fixture.details[url], headers: {} };
  });
  const extracted = await runScraper(config);
  assert.equal(extracted.success, true);
  assert.equal(extracted.concerts.length, 78);
  const published = await processConcerts(extracted.concerts, 'data/artists', NOW);
  assert.deepEqual(published.map(row => [row.artist, row.date, row.startTime, row.venue]), [
    ['Andreas Ottensamer', '2027-01-09', '19:00', 'Teatro Adolfo Mejía'],
    ['Gabriela Montero', '2027-01-09', '19:00', 'Teatro Adolfo Mejía'],
    ['Rinaldo Alessandrini', '2027-01-10', '11:00', 'Capilla del Hotel Sofitel Santa Clara'],
    ['Gabriela Montero', '2027-01-11', '11:00', 'Capilla del Hotel Sofitel Santa Clara'],
    ['Rinaldo Alessandrini', '2027-01-12', '11:00', 'Capilla del Hotel Sofitel Santa Clara'],
    ['Denis Bouriakov', '2027-01-12', '19:00', 'Capilla del Hotel Sofitel Santa Clara'],
    ['Denis Bouriakov', '2027-01-13', '16:00', 'Hotel Charleston Santa Teresa'],
    ['Andreas Ottensamer', '2027-01-13', '19:00', 'Teatro Adolfo Mejía'],
    ['Andreas Ottensamer', '2027-01-14', '19:00', 'Teatro Adolfo Mejía']
  ]);
  assert.ok(published.every(row => row.country === 'CO' && row.city === 'Cartagena' &&
    row.lat === undefined && row.lng === undefined && row.originalSource === config.domain));
  assert.ok(extracted.concerts.every(row => row.sourceEventUrl?.startsWith('https://cartagenamusicfestival.com/show-item/')),
    'sourceEventUrl is retained internally on raw records, not added to the public schema');
  const legacy = { artist: 'La Intuición del siglo XX', date: '16 January', venue: 'Teatro Adolfo Mejia',
    city: 'Cartagena', country: 'CO', originalSource: config.domain, scrapedAt: NOW,
    ticketUrl: 'https://cartagenamusicfestival.com/tc-events/la-intuicion-del-siglo-xx/?lang=en' };
  assert.deepEqual(await processConcerts([legacy], 'data/artists', NOW), []);
  assert.deepEqual(await processConcerts([legacy, ...extracted.concerts], 'data/artists', NOW), published);
});

test('stock runner fails the whole programme on late missing detail instead of reporting partial success', async t => {
  const { config, fixture, indexHtml } = await context(true);
  const failedUrl = Object.keys(fixture.details).at(-1);
  t.mock.method(axios, 'get', async (url: string) => {
    assert.ok(url === config.url || Object.hasOwn(fixture.details, url));
    return { status: 200, data: url === config.url ? indexHtml : url === failedUrl ? '<html>Missing detail</html>' : fixture.details[url], headers: {} };
  });
  const result = await runScraper(config);
  assert.equal(result.success, false);
  assert.deepEqual(result.concerts, []);
  assert.match(result.error || '', /Cartagena native detail identity missing/);
});
