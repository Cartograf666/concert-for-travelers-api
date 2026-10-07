import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { scrape } from '../src/engine/custom/artist-ai-kawashima.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

async function context() {
  const config = ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/artists/artist-ai-kawashima.json', 'utf8')));
  const fixture = JSON.parse(await readFile('tests/fixtures/artist-ai-kawashima-calendar-20261007.json', 'utf8')) as {
    indexHtml: string; details: Record<string, string>;
  };
  const fetch = async (url: string) => {
    assert.ok(Object.hasOwn(fixture.details, url), `Only linked first-party detail pages may be fetched: ${url}`);
    return fixture.details[url];
  };
  return { config, fixture, fetch };
}

test('official index/detail agreement yields two future shows with verified municipalities', async () => {
  const { config, fixture, fetch } = await context();
  assert.equal(config.type, 'custom_js');
  assert.equal(config.maxRetries, 3);
  assert.equal(config.requestDelayMs, 2000);
  assert.notEqual(config.allowEmpty, true);
  const rows = await scrape(config, fixture.indexHtml, '2026-10-07T07:00:00Z', fetch);
  assert.deepEqual(rows.map(row => [row.artist, row.date, row.venue, row.city, row.country]), [
    ['Ai Kawashima', '2026-11-15', 'イオンタウンユーカリが丘', 'Sakura', 'JP'],
    ['Ai Kawashima', '2026-10-31', '太田川駅前 大屋根広場', 'Tokai', 'JP']
  ]);
  assert.ok(rows.every(row => row.ticketUrl && fixture.details[row.ticketUrl] && row.originalSource === config.domain));
});

test('unknown municipality, conflicting detail date or mismatched official identity rejects the feed', async () => {
  const { config, fixture } = await context();
  const secondUrl = Object.keys(fixture.details)[1];
  for (const detail of [
    fixture.details[secondUrl].replace('太田川駅前 大屋根広場', '未確認会場'),
    fixture.details[secondUrl].replace('2026年10月31日', '2026年11月1日'),
    fixture.details[secondUrl].replace('<span>愛知</span>', '<span>岐阜</span>')
  ]) {
    assert.notEqual(detail, fixture.details[secondUrl]);
    await assert.rejects(scrape(config, fixture.indexHtml, '2026-10-07T07:00:00Z', async url =>
      url === secondUrl ? detail : fixture.details[url]), /venue|date|mismatch/);
  }
  for (const unsafeUrl of ['https://other.example/live/1', 'https://kawashimaai.com:8443/live/1']) {
    const $ = cheerio.load(fixture.indexHtml);
    $('#live_index table tr').eq(1).find('td.text a').attr('href', unsafeUrl);
    await assert.rejects(scrape(config, $.html(), '2026-10-07T07:00:00Z', async () => {
      throw new Error('Unexpected fetch');
    }), /unsafe native detail URL/);
  }
});

test('an archive-only index is not certified as a full empty future calendar', async () => {
  const { config, fixture } = await context();
  assert.deepEqual(await scrape(config, fixture.indexHtml, '2027-01-01T00:00:00Z', async () => {
    throw new Error('Past details should not be fetched');
  }), []);
  assert.notEqual(config.allowEmpty, true);
});
