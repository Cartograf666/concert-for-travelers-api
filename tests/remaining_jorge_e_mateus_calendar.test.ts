import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-jorge-e-mateus.js';
import { runScraper } from '../src/engine/runner.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const base = 'https://www.jorgeemateus.com.br/wp-json/agenda/v1/eventos/month';

async function input() {
  const [configText, html, historicalText] = await Promise.all([
    readFile('scrapers/artist-jorge-e-mateus.json', 'utf8'),
    readFile('tests/fixtures/artist-jorge-e-mateus-agenda-20261006.html', 'utf8'),
    readFile('tests/fixtures/artist-jorge-e-mateus-2022-04.json', 'utf8')
  ]);
  return { config: ScraperConfigSchema.parse(JSON.parse(configText)), html,
    historical: JSON.parse(historicalText) as Record<string, Record<string, string>> };
}

test('official current and next native months are explicitly empty, including December rollover', async () => {
  const { config, html } = await input();
  assert.equal(config.type, 'custom_js');
  assert.equal(config.httpClient, 'got-scraping');
  assert.equal(config.allowEmpty, true);
  const urls: string[] = [];
  const rows = await scrape(config, html, '2026-12-06T12:00:00.000Z', async url => {
    urls.push(url);
    return '[]';
  });
  assert.deepEqual(rows, []);
  assert.deepEqual(urls, [`${base}/12/year/2026`, `${base}/1/year/2027`]);
});

test('real complete historical records prove populated object contract and explicit Brazilian state geography', async () => {
  const { config, html, historical } = await input();
  const complete = Object.fromEntries(Object.entries(historical).filter(([, row]) => row.agenda_local));
  const rows = await scrape(config, html, '2022-04-01T00:00:00.000Z', async url =>
    url.endsWith('/4/year/2022') ? JSON.stringify(complete) : '[]');
  assert.deepEqual(rows.map(row => [row.date, row.city, row.venue, row.country]), [
    ['2022-04-01', 'São Paulo', 'Estância Alto da Serra', 'BR'],
    ['2022-04-08', 'São Paulo', 'Espaço das Américas', 'BR'],
    ['2022-04-10', 'Itupeva', "Wet'n Wild", 'BR'],
    ['2022-04-14', 'Florianópolis', 'Arena Petry', 'BR']
  ]);
  assert.ok(rows.every(row => row.originalSource === config.domain && row.ticketUrl === config.url));
  // The official UI displays title as city/state; agenda_cidade is optional.
  const titleOnly = { ...historical['sao-paulo-sp-18'], agenda_cidade: '' };
  const fallback = await scrape(config, html, '2022-04-01T00:00:00.000Z', async url =>
    url.endsWith('/4/year/2022') ? JSON.stringify({ show: titleOnly }) : '[]');
  assert.equal(fallback.length, 1);
  assert.deepEqual([fallback[0].city, fallback[0].country], ['São Paulo', 'BR']);
});

test('incomplete real archive month fails as a whole instead of hiding venue gaps', async () => {
  const { config, html, historical } = await input();
  await assert.rejects(scrape(config, html, '2022-04-01T00:00:00.000Z', async () => JSON.stringify(historical)),
    /missing or non-venue location/);
});

test('wrong agenda identity and invalid API shape cannot become a successful empty schedule', async () => {
  const { config, html } = await input();
  await assert.rejects(scrape(config, html.replace('Jorge &amp; Mateus', 'Other act'),
    '2026-10-06T12:00:00.000Z', async () => '[]'), /identity/);
  for (const response of ['{}', '<html>blocked</html>', '[{"agenda_data":"20261010"}]']) {
    await assert.rejects(scrape(config, html, '2026-10-06T12:00:00.000Z', async () => response), /API/);
  }
});

test('future year, invalid calendar, geography and venue stay fail closed', async () => {
  const { config, html, historical } = await input();
  const actual = historical['sao-paulo-sp-18'];
  assert.ok(actual);
  const valid = { ...actual, agenda_data: '20380115' };
  const future = await scrape(config, html, '2038-01-02T00:00:00.000Z', async url =>
    url.endsWith('/1/year/2038') ? JSON.stringify({ show: valid }) : '[]');
  assert.deepEqual(future.map(row => [row.date, row.city, row.country]), [['2038-01-15', 'São Paulo', 'BR']]);
  for (const [change, error] of [
    [{ agenda_data: '20380230' }, /date outside requested/],
    [{ agenda_data: '20380115', title: 'Lisboa/PT', agenda_cidade: 'Lisboa/PT' }, /unsupported city/],
    [{ agenda_data: '20380115', title: 'Birmingham/AL', agenda_cidade: 'Birmingham/AL' }, /ambiguous country/],
    [{ agenda_data: '20380115', title: 'Boston/MA', agenda_cidade: 'Boston/MA' }, /ambiguous country/],
    [{ agenda_data: '20380115', title: 'Philadelphia/PA', agenda_cidade: 'Philadelphia/PA' }, /ambiguous country/],
    [{ agenda_data: '20380115', agenda_local: '' }, /missing or non-venue/],
    [{ agenda_data: '20380115', agenda_local: 'JORGE E MATEUS ÚNICO' }, /missing or non-venue/],
    [{ agenda_data: '20380115', agenda_cidade: 'Campinas/SP' }, /city\/title mismatch/]
  ] as const) {
    await assert.rejects(scrape(config, html, '2038-01-02T00:00:00.000Z', async () =>
      JSON.stringify({ show: { ...valid, ...change } })), error);
  }
});

test('fresh-source runner bypasses stale shell validators and the Jorge adapter reloads changed monthly data', async t => {
  let html = '<html><body></body></html>';
  let force304 = false;
  const requests: Array<{ etag?: string; modified?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ etag: request.headers['if-none-match'], modified: request.headers['if-modified-since'] });
    if (force304 || request.headers['if-none-match'] || request.headers['if-modified-since']) {
      response.writeHead(304, { ETag: '"same-shell"' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html', ETag: '"same-shell"',
      'Last-Modified': 'Tue, 06 Oct 2026 20:05:34 GMT' });
    response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config: ScraperConfig = {
    id: 'jorge-monthly-cache-proof', domain: 'jorge-cache-proof.test',
    url: `http://127.0.0.1:${address.port}/agenda/`, type: 'static_selectors', allowEmpty: true,
    skipConditionalRequests: true, maxRetries: 0,
    selectors: { eventBlock: '.event', artistNameFallback: 'Jorge e Mateus', date: 'time',
      venueNameFallback: 'Fixture Hall', cityNameFallback: 'São Paulo', countryNameFallback: 'BR' }
  };
  const first = await runScraper(config);
  assert.equal(first.success, true, first.error);
  assert.equal(first.reason, 'empty_schedule');
  assert.equal(first.lastModified, 'Tue, 06 Oct 2026 20:05:34 GMT');
  html = '<div class="event"><time>2038-01-15</time></div>';
  const second = await runScraper(config, {
    concerts: first.concerts, contentHash: first.contentHash!, cacheFingerprint: first.cacheFingerprint!,
    scrapedAt: first.scrapedAt, etag: first.etag, lastModified: first.lastModified
  });
  assert.equal(second.success, true, second.error);
  assert.equal(second.concerts.length, 1, 'new data must be parsed despite unchanged shell validators');
  assert.deepEqual(requests, [
    { etag: undefined, modified: undefined }, { etag: undefined, modified: undefined }
  ], 'no conditional headers are sent on either run');

  const normalConfig: ScraperConfig = { ...config, id: 'jorge-cache-default-proof', skipConditionalRequests: undefined };
  const normalFirst = await runScraper(normalConfig);
  const normalSecond = await runScraper(normalConfig, {
    concerts: normalFirst.concerts, contentHash: normalFirst.contentHash!,
    cacheFingerprint: normalFirst.cacheFingerprint!, scrapedAt: normalFirst.scrapedAt,
    etag: normalFirst.etag, lastModified: normalFirst.lastModified
  });
  assert.equal(normalSecond.success, true, normalSecond.error);
  assert.equal(normalSecond.notModified, true, 'default configs still reuse HTTP 304');
  assert.equal(requests[3].etag, '"same-shell"');
  assert.equal(requests[3].modified, 'Tue, 06 Oct 2026 20:05:34 GMT');

  force304 = true;
  const unsolicited = await runScraper(config, {
    concerts: first.concerts, contentHash: first.contentHash!, cacheFingerprint: first.cacheFingerprint!,
    scrapedAt: first.scrapedAt, etag: first.etag, lastModified: first.lastModified
  });
  assert.equal(unsolicited.success, false);
  assert.match(unsolicited.error || '', /Received 304 without permitted conditional cache reuse/);
  force304 = false;

  const { config: jorge, html: officialHtml, historical } = await input();
  const event = { ...historical['sao-paulo-sp-18'], agenda_data: '20380115' };
  const urls: string[] = [];
  let monthly = '[]';
  const fetchMonth = async (url: string) => { urls.push(url); return url.endsWith('/1/year/2038') ? monthly : '[]'; };
  assert.deepEqual(await scrape(jorge, officialHtml, '2038-01-02T00:00:00.000Z', fetchMonth), []);
  monthly = JSON.stringify({ 'sao-paulo-sp-18': event });
  const fresh = await scrape(jorge, officialHtml, '2038-01-02T00:00:00.000Z', fetchMonth);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].date, '2038-01-15');
  assert.deepEqual(urls, [
    `${base}/1/year/2038`, `${base}/2/year/2038`,
    `${base}/1/year/2038`, `${base}/2/year/2038`
  ]);
});
