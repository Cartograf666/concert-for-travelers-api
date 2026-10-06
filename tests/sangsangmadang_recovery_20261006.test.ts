import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../src/engine/custom/kt-g-sangsangmadang-seoul.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
const config = ScraperConfigSchema.parse(JSON.parse(readFileSync('scrapers/kt-g-sangsangmadang-seoul.json', 'utf8')));
const body = readFileSync('tests/fixtures/sangsangmadang-recovery-20261006/official-schedule.json', 'utf8');
const observedAt = '2026-10-06T12:00:00Z';
test('official Hongdae widget restores OurR with explicit date and venue', async () => {
  const rows = await scrape(config, body, observedAt);
  assert.equal(rows.length, 1); assert.equal(rows[0].artist, 'OurR');
  assert.equal(rows[0].date, '2026-10-11'); assert.equal(rows[0].country, 'KR');
  assert.equal(rows[0].ticketUrl, 'https://www.sangsangmadang.com/show/detail/3183');
});
test('pagination validates coverage and payload changes fail instead of returning partial rows', async () => {
  const first = JSON.parse(body); first.showListInfo.totalCount = 2;
  const next = structuredClone(first); next.showListInfo.showList[0].contentsSeq = 3184;
  const urls: string[] = [];
  const rows = await scrape({...config, requestDelayMs: 0}, JSON.stringify(first), observedAt, async (url) => {urls.push(url); return JSON.stringify(next);});
  assert.equal(rows.length, 2); assert.equal(new URL(urls[0]).searchParams.get('page'), '2');
  await assert.rejects(scrape({...config, requestDelayMs: 0}, JSON.stringify(first), observedAt, async () => body), /changed/);
  await assert.rejects(scrape(config, '<html>Error</html>', observedAt));
  const invalid = JSON.parse(body); invalid.showListInfo.showList[0].startDt = '20260230';
  await assert.rejects(scrape(config, JSON.stringify(invalid), observedAt), /calendar/);
  assert.deepEqual(await scrape(config, JSON.stringify({showListInfo:{showList:[], totalCount:0}}), observedAt), []);
});
