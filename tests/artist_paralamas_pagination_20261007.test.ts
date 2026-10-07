import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape } from '../src/engine/custom/artist-paralamas-do-sucesso.js';

const config = ScraperConfigSchema.parse(JSON.parse(readFileSync(join(process.cwd(),
  'scrapers/artists/artist-paralamas-do-sucesso.json'), 'utf8')));
const first = readFileSync(join(process.cwd(),
  'tests/fixtures/paralamas-archive-page1-20261007.html'), 'utf8');
const second = readFileSync(join(process.cwd(),
  'tests/fixtures/paralamas-archive-page2-20261007.html'), 'utf8');
const nextUrl = 'https://www.osparalamas.com.br/evento/page/2/';
const at = '2026-10-07T00:00:00.000Z';

test('Paralamas follows its actual official next page and retains Montes Claros', async () => {
  assert.equal(config.url, 'https://www.osparalamas.com.br/evento/');
  assert.equal(config.httpClient, 'got-scraping');
  assert.equal(config.skipConditionalRequests, true);
  const requested: string[] = [];
  const rows = await scrape({ ...config, requestDelayMs: 0 }, first, at, async url => {
    requested.push(url);
    return second;
  });
  assert.deepEqual(requested, [nextUrl]);
  assert.equal(rows.length, 9, 'ten first-page rows contain two cruises; page two has the ninth city concert');
  assert.deepEqual(rows.map(row => [row.date, row.city]), [
    ['2026-10-08', 'São Luís'], ['2026-10-09', 'São Luís'], ['2026-10-11', 'Teresina'],
    ['2026-10-17', 'Londrina'], ['2026-10-30', 'Porto Alegre'], ['2026-11-08', 'Nova Iguaçu'],
    ['2026-12-06', 'Rio de Janeiro'], ['2026-12-19', 'São Paulo'], ['2027-03-06', 'Montes Claros']
  ]);
  assert.equal(rows.at(-1)?.venue, 'Rock in Moc Brasil no Estacionamento Montes Claros Shopping');
  assert.equal(rows.at(-1)?.ticketUrl, 'https://www.osparalamas.com.br/evento/montes-claros-mg/#top');
  assert.ok(rows.every(row => row.country === 'BR' && row.artist === 'Paralamas do Sucesso'));
});

test('unchanged first page never substitutes stale complete data when page two fails', async () => {
  const current = { ...config, requestDelayMs: 0, maxRetries: 0 };
  const firstRun = await scrape(current, first, at, async url => {
    assert.equal(url, nextUrl);
    return second;
  });
  assert.equal(firstRun.length, 9);
  let requested = 0;
  await assert.rejects(scrape(current, first, '2026-10-08T00:00:00.000Z', async url => {
    assert.equal(url, nextUrl);
    requested++;
    throw Object.assign(new Error('second page timed out'), { code: 'ETIMEDOUT' });
  }), /second page timed out/);
  assert.equal(requested, 1);
  assert.equal(config.skipConditionalRequests, true,
    'runner must fetch unchanged first-page HTML again instead of accepting its HTTP 304 cache');
});

test('a changed, off-site or repeated pagination path fails the entire source', async () => {
  const current = { ...config, requestDelayMs: 0, maxRetries: 0 };
  const wrongHost = first.replaceAll(nextUrl, 'https://evil.example/evento/page/2/');
  await assert.rejects(scrape(current, wrongHost, at, async () => second), /outside its first-party archive/);
  const skippedPage = first.replaceAll(nextUrl, 'https://www.osparalamas.com.br/evento/page/3/');
  await assert.rejects(scrape(current, skippedPage, at, async () => second), /does not advance one page/);
  const repeated = second.replace('montes-claros-mg', 'sao-luis-ma-3');
  await assert.rejects(scrape(current, first, at, async () => repeated), /repeats an event or page/);
  const missingCity = second.replace('Montes Claros (MG), Rock in Moc Brasil no Estacionamento Montes Claros Shopping',
    'Rock in Moc Brasil');
  await assert.rejects(scrape(current, first, at, async () => missingCity), /no complete city and venue/);
});
