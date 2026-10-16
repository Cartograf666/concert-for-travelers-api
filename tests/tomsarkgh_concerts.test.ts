import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { detailUrls, parseDetail, scrape } from '../src/engine/custom/tomsarkgh-concerts.js';
import { runScraper } from '../src/engine/runner.js';

const AT = '2026-10-16T19:00:00.000Z';
const root = 'https://www.tomsarkgh.am';
const urls = {
  andru: `${root}/en/event/51067/Andru-Donalds.html`,
  uspenskaya: `${root}/en/event/46842/Lyubov-Uspenskaya-in-Yerevan.html`,
  akmal: `${root}/en/event/51626/Akmal.html`
};
const fixture = (name: string) => readFile(`tests/fixtures/tomsarkgh/${name}.html`, 'utf8');
const config = async () => ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/tomsarkgh-concerts.json', 'utf8')));

test('captured native microdata supplies exact performer, full year, time and address-derived geography', async () => {
  const expected = [
    ['andru', 'Andru Donalds', '2026-11-21', 'Aram Khachaturyan Concert Hall'],
    ['uspenskaya', 'Lyubov Uspenskaya', '2027-01-30', 'Karen Demirchyan Sports and Concerts Complex'],
    ['akmal', 'Akmal', '2027-02-19', 'Karen Demirchyan Sports and Concerts Complex']
  ];
  for (const [name, artist, date, venue] of expected) {
    assert.deepEqual(parseDetail(await fixture(name), urls[name as keyof typeof urls], AT), [{
      artist, date, startTime: '19:00', venue, city: 'Yerevan', country: 'AM',
      ticketUrl: urls[name as keyof typeof urls], originalSource: 'www.tomsarkgh.am', scrapedAt: AT
    }]);
  }
});

test('listing follows only inspected performer headings and same-origin event routes, not footer theatre or checkout', async () => {
  const html = await fixture('listing');
  assert.deepEqual(new Set(detailUrls(html)), new Set(Object.values(urls)));
  assert.deepEqual(detailUrls(html.replaceAll('/en/event/', 'https://evil.example/en/event/')), []);
  assert.deepEqual(detailUrls(html.replaceAll('/en/event/', '/place/hallplan?event=')), []);
});

test('withholds uncertain performer/work title, non-concert category and cancelled/postponed detail', async () => {
  const html = await fixture('akmal');
  for (const altered of [
    html.replace('>Akmal </h1>', '>Mozart Requiem</h1>'),
    html.replace('>Akmal </h1>', '>Akmal tribute</h1>'),
    html.replace('itemtype="http://schema.org/Event"', 'itemtype="http://schema.org/ScreeningEvent"'),
    html.replace('id="eventDesc">', 'id="eventDesc">Cancelled ')
  ]) {
    assert.notEqual(altered, html, 'negative mutation must change native input');
    assert.deepEqual(parseDetail(altered, urls.akmal, AT), []);
  }
  assert.deepEqual(parseDetail(html.replace('>Akmal </h1>', '>Akmal postponed</h1>'), urls.akmal, AT), []);
});

test('never recycles missing year, impossible date, past date or invalid time', async () => {
  const html = await fixture('akmal');
  for (const date of ['02-19 19:00', '2027-02-30 19:00', '2025-02-19 19:00', '2027-02-19 25:00']) {
    assert.deepEqual(parseDetail(html.replace('2027-02-19 19:00', date), urls.akmal, AT), []);
  }
  assert.deepEqual(parseDetail(html, urls.akmal, 'invalid-clock'), []);
});

test('does not guess geography or trust conflicting native fields/canonical URL', async () => {
  const html = await fixture('akmal');
  for (const address of ['', 'Yerevan', 'Yerevan, Armenia', 'Street, Tbilisi, Georgia']) {
    assert.deepEqual(parseDetail(html.replace('Tsitsernakaberd hill, Yerevan, Armenia', address), urls.akmal, AT), []);
  }
  assert.equal(parseDetail(html.replace('Tsitsernakaberd hill, Yerevan, Armenia', 'Test street, Gyumri, Armenia'), urls.akmal, AT)[0]?.city, 'Gyumri');
  assert.deepEqual(parseDetail(html.replace('itemprop="startDate"', 'itemprop="missingDate"'), urls.akmal, AT), []);
  assert.deepEqual(parseDetail(html.replace('itemprop="startDate" content="2027-02-19 19:00"', 'itemprop="startDate" content="2027-02-19 19:00"/><meta content="2027-02-20 19:00" itemprop="startDate"'), urls.akmal, AT), []);
  assert.deepEqual(parseDetail(html, urls.andru, AT), []);
});

test('real runner dispatch uses the complete captured response set without live network', async t => {
  const cfg = await config();
  const captured = new Map<string, string>([[cfg.url, await fixture('listing')]]);
  for (const [name, url] of Object.entries(urls)) captured.set(url, await fixture(name));
  const requested: string[] = [];
  t.mock.timers.enable({ apis: ['Date'], now: new Date(AT) });
  t.mock.method(axios, 'get', async (url: string) => {
    requested.push(url);
    assert.ok(captured.has(url), `uncaptured request ${url}`);
    return { status: 200, data: captured.get(url), headers: {} };
  });
  const previous = process.env.SCRAPER_HTTP_BACKEND;
  process.env.SCRAPER_HTTP_BACKEND = 'axios';
  t.after(() => { if (previous === undefined) delete process.env.SCRAPER_HTTP_BACKEND; else process.env.SCRAPER_HTTP_BACKEND = previous; });
  const result = await runScraper(cfg);
  assert.equal(result.success, true, result.error);
  assert.equal(result.concerts.length, 3);
  assert.deepEqual(new Set(requested), new Set(captured.keys()));
});


test('detail failure rejects the source instead of reporting a successful partial response', async t => {
  const cfg = await config();
  let calls = 0;
  t.mock.method(axios, 'get', async () => {
    calls += 1;
    if (calls === 2) throw new Error('captured access failure');
    return { status: 200, data: await fixture('uspenskaya'), headers: {} };
  });
  await assert.rejects(scrape(cfg, await fixture('listing'), AT), /captured access failure/);
  assert.equal(calls, 2);
});

test('unsupported source scope and detail overflow fail closed without following arbitrary links', async () => {
  const cfg = await config();
  assert.deepEqual(await scrape({ ...cfg, url: 'https://www.tomsarkgh.am/en/' }, await fixture('listing'), AT), []);
  const cards = Array.from({ length: 7 }, (_, i) => `<div class="event-box-item"><div class="event-type">Concert</div><h4 class="event-title"><a href="/en/event/${i}/Akmal.html">Akmal</a></h4></div>`).join('');
  assert.throws(() => detailUrls(cards), /detail limit/);
});
