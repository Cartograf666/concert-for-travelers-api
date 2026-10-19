import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper } from '../src/engine/runner.js';
import { extractJsonLd } from '../src/engine/structured.js';
import { scrape } from '../src/engine/custom/ddt-tour.js';
import { processConcerts } from '../src/pipeline/process.js';

const root = 'tests/fixtures/ru-data-2-west/';
const captures = JSON.parse(readFileSync(root + 'captures.json', 'utf8'));
const { clock, calendarCapture } = JSON.parse(readFileSync(root + 'clock.json', 'utf8'));
const html = gunzipSync(readFileSync(root + calendarCapture)).toString('utf8');
const config = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/artists/ddt-tour.json', 'utf8')));
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function mutateEvent(change: (event: Record<string, any>) => void) {
  const $ = cheerio.load(html);
  const script = $('script[type="application/ld+json"]').first();
  const events = JSON.parse(script.text());
  change(events[0]);
  script.text(JSON.stringify(events));
  return $.html();
}

test('all west native fixture bodies retain their original response hashes', () => {
  assert.ok(captures.length >= 12);
  for (const capture of captures) {
    assert.equal(capture.method, 'GET');
    assert.equal(capture.tlsVerification, true);
    assert.ok(Number.isFinite(Date.parse(capture.capturedAt)));
    if (!capture.fixtureBody) continue;
    const compressed = readFileSync(root + capture.fixtureBody);
    assert.equal(sha(compressed), capture.fixtureSha256, capture.url);
    assert.equal(sha(gunzipSync(compressed)), capture.sha256, capture.url);
  }
});

test('native DDT config response -> runScraper -> actual artistDb fixture read -> processConcerts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(clock) });
  const requested: string[] = [];
  t.mock.method(axios, 'get', async (url: string) => {
    requested.push(url);
    const capture = captures.find((entry: any) => entry.url === url);
    assert.ok(capture, `No native response for ${url}`);
    assert.equal(capture.status, 200);
    return { status: capture.status, data: gunzipSync(readFileSync(root + capture.fixtureBody)).toString('utf8'), headers: {} };
  });
  const result = await runScraper(config);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(requested, [config.url]);
  assert.deepEqual(result.concerts.map(row => [row.artist, row.date, row.city, row.country, row.startTime]), [
    ['ДДТ', '2026-12-05', 'Essen', 'DE', '20:00'],
    ['ДДТ', '2026-12-09', 'Ingolstadt', 'DE', '20:00']
  ]);
  assert.ok(result.concerts.every(row => row.ticketUrl?.startsWith(config.url + '/') && row.scrapedAt === new Date(clock).toISOString()));
  assert.deepEqual(result.concerts.map(row => (row as { sourceEventUrl?: string }).sourceEventUrl),
    result.concerts.map(row => row.ticketUrl));
  const normalized = await processConcerts(result.concerts, root + 'approved-artists.json', clock);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every(row => row.artist === 'ДДТ' && row.country === 'DE'));
  assert.ok(normalized.every(row => row.ticketUrl === 'https://ddt.ru/' && !('sourceEventUrl' in row)));
  assert.deepEqual(await processConcerts([...result.concerts, ...result.concerts], root + 'approved-artists.json', clock), normalized);
  // Demonstrates why generic JSON-LD would attribute the band's concerts to its singer.
  assert.ok(extractJsonLd(config, html, clock).every(row => row.artist === 'Yuri Shevchuk'));
});

test('DDT rejects a different page, singer-only billing and unrelated performer', async () => {
  await assert.rejects(scrape(config, html.replace('<h1', '<h9').replace('</h1>', '</h9>'), clock), /identity/);
  await assert.rejects(scrape({ ...config, url: 'https://biletkartina.tv/' }, html, clock), /identity/);
  for (const name of ['Юрий Шевчук', 'Баста', 'Meet & Greet DDT', 'Gift Certificate']) {
    await assert.rejects(scrape(config, mutateEvent(event => { event.name = name; }), clock), /identity/);
  }
  await assert.rejects(scrape(config, mutateEvent(event => { event.performer.name = 'Other singer'; }), clock), /identity/);
});

test('DDT cannot publish merchandise, postponed/cancelled events or stale dates', async () => {
  for (const type of ['Product', 'Organization', 'MeetAndGreet', 'Event']) {
    const rows = await scrape(config, mutateEvent(event => { event['@type'] = type; }), clock);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].city, 'Ingolstadt');
  }
  for (const state of ['EventCancelled', 'EventPostponed', 'EventRescheduled']) {
    const rows = await scrape(config, mutateEvent(event => { event.eventStatus = 'https://schema.org/' + state; }), clock);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].city, 'Ingolstadt');
  }
  assert.deepEqual(await scrape(config, html, '2027-01-01T00:00:00Z'), []);
});

test('DDT refuses missing year, impossible date/time, missing place and unsafe event URL', async () => {
  for (const stamp of ['12-05T20:00:00+01:00', '2026-02-30T20:00:00+01:00', '2026-12-05T99:00:00+01:00', '']) {
    await assert.rejects(scrape(config, mutateEvent(event => { event.startDate = stamp; }), clock), /date/);
  }
  for (const change of [
    (event: any) => { event.location.address.addressLocality = ''; },
    (event: any) => { event.location.name = ''; }
  ]) await assert.rejects(scrape(config, mutateEvent(change), clock), /place|country/);
  for (const url of ['javascript:alert(1)', 'https://biletkartina.tv.evil.example/event', config.url + '/essen-2027-12-05']) {
    await assert.rejects(scrape(config, mutateEvent(event => { event.url = url; event.offers.url = url; }), clock), /URL/);
  }
});

// Synthetic mutations of the immutable native capture; these are not source claims.
test('DDT accepts explicit ISO countries and names while preserving mixed DE + AT calendars', async () => {
  for (const [label, country] of [
    ['DE', 'DE'], ['AT', 'AT'], ['Austria', 'AT'], ['Österreich', 'AT'], ['RU', 'RU'],
    [{ '@type': 'Country', name: 'Austria' }, 'AT'],
    [{ '@type': 'Country', identifier: 'AT' }, 'AT'],
    [{ '@type': 'Country', name: 'Austria', identifier: 'AT' }, 'AT']
  ] as const) {
    const rows = await scrape(config, mutateEvent(event => { event.location.address.addressCountry = label; }), clock);
    assert.deepEqual(rows.map(row => row.country), [country, 'DE']);
    assert.equal(rows[0].city, 'Essen'); // Country must come from the field, never the city/title/domain.
    assert.ok(rows.every(row => row.sourceEventUrl === row.ticketUrl));
  }
});

test('DDT skips only rows without a trustworthy explicit country, ignoring config fallback', async () => {
  for (const label of [undefined, null, '', 'ZZ', 'XX', 'Atlantis', 'Essen', 123,
    {}, { name: 'Austria' }, { '@type': 'City', name: 'Austria' },
    { '@type': 'Country', name: 'Atlantis' }, { '@type': 'Country', identifier: 'ZZ' },
    { '@type': 'Country', name: 'Austria', identifier: 'DE' },
    { '@type': 'Country', name: 'Austria', identifier: 123 }
  ]) {
    const body = mutateEvent(event => { event.location.address.addressCountry = label; });
    for (const fallback of ['DE', 'AT']) {
      const rows = await scrape({ ...config, selectors: { ...config.selectors!, countryNameFallback: fallback } }, body, clock);
      assert.equal(rows.length, 1, JSON.stringify(label));
      assert.equal(rows[0].city, 'Ingolstadt');
      assert.equal(rows[0].country, 'DE');
    }
  }
});

test('DDT retains offline attendance and matching native offer URL controls', async () => {
  const rows = await scrape(config, mutateEvent(event => {
    event.eventAttendanceMode = 'https://schema.org/OnlineEventAttendanceMode';
  }), clock);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].city, 'Ingolstadt');
  await assert.rejects(scrape(config, mutateEvent(event => { event.offers.url = config.url; }), clock), /URL/);
});
