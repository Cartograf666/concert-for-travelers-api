import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import { scrape as maiden } from '../src/engine/custom/artist-iron-maiden.js';
import { scrape as bluetones } from '../src/engine/custom/artist-the-bluetones.js';
import { loadConfigs } from '../src/engine/runner.js';
import type { ScrapeCache } from '../src/engine/cache.js';
const run = promisify(execFile);
const cases = [
  { id: 'artist-iron-maiden', file: 'maiden', badDate: '16 May', parse: maiden, row: '.tour-info-row:last-child', date: '.tour-info-col:first-child', venue: '.tour-info-col:nth-child(3)', city: '.tour-info-col:nth-child(2)', full: 16 },
  { id: 'artist-the-bluetones', file: 'bluetones', badDate: '08/05', parse: bluetones, row: 'tr.gigpress-row:has(.gigpress-city:contains("Guiseley"))', date: '.gigpress-date', venue: '.gigpress-venue', city: '.gigpress-city', full: 12 }
];
const at = '2026-10-28T00:00:00.000Z';
const input = (file: string) => readFile(`tests/fixtures/official-remaining-20261028/${file}.html`, 'utf8');

test('a single malformed active source row rejects the complete parse; explicit cancellation is distinct', async () => {
  const configs = await loadConfigs('scrapers/artists');
  for (const source of cases) {
    const config = configs.find(c => c.id === source.id)!;
    const html = await input(source.file);
    assert.equal((await source.parse(config, html, at)).length, source.full);
    for (const [selector, value] of [[source.date, source.badDate], [source.venue, ''], [source.city, '']] as const) {
      const $ = cheerio.load(html);
      const row = $(source.row).last(); assert.equal(row.length, 1);
      row.find(selector).first().text(value);
      await assert.rejects(source.parse(config, $.html(), at), /malformed active/i, `${source.id} malformed ${selector}`);
      row.addClass('cancelled');
      assert.equal((await source.parse(config, $.html(), at)).length, source.full - 1);
    }
  }
});

test('actual artist runner/caller keeps full last-good cache on one bad row and updates only explicit cancellations', async () => {
  const configs = await loadConfigs('scrapers/artists');
  const originals = new Map(await Promise.all(cases.map(async s => [s.id, await input(s.file)] as const)));
  const pages = new Map(originals);
  const dir = await mkdtemp(join(tmpdir(), 'official-partial-cache-'));
  try {
    await mkdir(join(dir, 'scrapers/artists'), { recursive: true });
    await mkdir(join(dir, 'data/artists'), { recursive: true });
    await writeFile(join(dir, 'data/artist_scrape_targets.txt'), '');
    const transports: Record<string, string> = {};
    for (const source of cases) {
      const config = configs.find(c => c.id === source.id)!;
      transports[config.url] = join(dir, `${source.id}.html`);
      await writeFile(join(dir, `scrapers/artists/${source.id}.json`), JSON.stringify({ ...config, requestDelayMs: 0 }));
    }
    // Only HTTP transport is mocked in the child. Public configs, loader,
    // dynamic custom import, runner failure and actual caller/cache writes run.
    const preload = join(dir, 'fixture-transport.cjs');
    await writeFile(preload, `const fs = require('node:fs'); const axios = require(${JSON.stringify(require.resolve('axios'))}); const pages = ${JSON.stringify(transports)}; axios.get = async url => { if (!Object.hasOwn(pages, url)) throw new Error('Unexpected HTTP request'); return { status: 200, data: fs.readFileSync(pages[url], 'utf8'), headers: {} }; };`);
    const scrape = async () => {
      for (const [id, html] of pages) await writeFile(join(dir, `${id}.html`), html);
      const result = await run(process.execPath, ['--require', preload, '--import', require.resolve('tsx'), resolve('src/run-artists.ts')], {
        cwd: dir, env: { ...process.env, SCRAPER_ALLOW_LOCAL_HOSTS: '1' }, timeout: 30000
      });
      assert.match(result.stdout, /No artist targets found -- skipping Bandsintown\/Eventbrite sweeps/);
      return JSON.parse(await readFile(join(dir, 'reports/artist-scrape-cache.json'), 'utf8')) as ScrapeCache;
    };
    const good = await scrape();
    for (const source of cases) {
      assert.equal(good[source.id].concerts.length, source.full);
      assert.ok(good[source.id].verifiedAt);
      const $ = cheerio.load(originals.get(source.id)!);
      $(source.row).last().find(source.date).first().text(source.badDate);
      pages.set(source.id, $.html());
    }
    const retained = await scrape();
    assert.deepEqual(retained, good, 'actual caller must retain events, fingerprint, hash and verification timestamps on parse failure');
    const failures = JSON.parse(await readFile(join(dir, 'reports/fail-log.json'), 'utf8')) as { id: string; reason: string; error: string }[];
    assert.equal(failures.length, 2);
    for (const source of cases) {
      const failure = failures.find(r => r.id === source.id)!;
      assert.equal(failure.reason, 'parse_error'); assert.match(failure.error, /malformed active/i);
      const $ = cheerio.load(pages.get(source.id)!);
      $(source.row).last().addClass('cancelled'); pages.set(source.id, $.html());
    }
    const cancelled = await scrape();
    for (const source of cases) assert.equal(cancelled[source.id].concerts.length, source.full - 1);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'reports/fail-log.json'), 'utf8')), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
