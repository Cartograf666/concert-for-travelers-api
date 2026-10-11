import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyConfigLive, verifyEvents, formatVerifyReport } from '../src/healing/verify.js';
import { runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ScraperConfig } from '../src/schemas/config.js';

const NOW = new Date('2026-07-28T00:00:00.000Z');
const CONFIG: ScraperConfig = {
  id: 'semantic-probe', domain: 'example.com', url: 'https://example.com/events', type: 'jsonld'
};
const goodRows = (n = 10): Partial<Concert>[] => Array.from({ length: n }, (_, i) => ({
  artist: 'The Cure', date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  venue: 'Concert Hall', city: 'Berlin', country: 'DE',
  originalSource: 'example.com', scrapedAt: NOW.toISOString()
}));

async function withApproved(fn: (approvedArtistsPath: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'healing-semantic-'));
  const db = join(root, 'approved.json');
  try {
    await writeFile(db, JSON.stringify([
      { name: 'The Cure' }, { name: 'Andrea Motis' },
      { name: 'Hermann Nitsch', mbid: 'cbadeb12-bb3c-490f-95f4-f6444c111f32' }
    ]));
    await fn(db);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('live repair gate rejects captured Nitsch raw success quarantined by the public pipeline', async () => {
  const { raw } = JSON.parse(await readFile('tests/fixtures/nitsch-source-provenance.json', 'utf8')) as { raw: Partial<Concert>[] };
  const config = JSON.parse(await readFile('scrapers/artists/artist-hermann-nitsch.json', 'utf8')) as ScraperConfig;
  const now = new Date('2026-10-06T21:26:20.449Z');
  assert.equal(verifyEvents(raw, config, { now }).ok, true, 'raw plausibility alone misses the source quarantine');
  await withApproved(async approvedArtistsPath => {
    assert.equal((await processConcerts(raw, approvedArtistsPath, now.toISOString())).length, 0);
    const report = await verifyConfigLive(config, async () => ({ success: true, concerts: raw }), { now, approvedArtistsPath });
    assert.equal(report.ok, false, formatVerifyReport(report));
    assert.equal(report.publicEventCount, 0);
    assert.match(formatVerifyReport(report), /public_events.*notApproved/);
  });
});

for (const [label, rows] of [
  ['missing city', goodRows().map(row => ({ ...row, city: '' }))],
  ['unapproved artist', goodRows().map(row => ({ ...row, artist: 'Unlisted Performer' }))],
  ['only yesterday', goodRows().map(row => ({ ...row, date: '2026-07-27' }))],
  ['invalid timestamp', goodRows().map(row => ({ ...row, scrapedAt: 'not-a-timestamp' }))]
] as const) {
  test(`live repair gate rejects plausible raw rows with ${label} that cannot publish`, async () => {
    assert.equal(verifyEvents(rows, CONFIG, { now: NOW }).ok, true);
    await withApproved(async approvedArtistsPath => {
      const report = await verifyConfigLive(CONFIG, async () => ({ success: true, concerts: rows }), { now: NOW, approvedArtistsPath });
      assert.equal(report.ok, false, formatVerifyReport(report));
      assert.equal(report.publicEventCount, 0);
    });
  });
}

test('live repair gate compares retained public identities, not inflated raw duplicates', async () => {
  await withApproved(async approvedArtistsPath => {
    const baselineEvents = goodRows();
    const rows = Array.from({ length: 10 }, () => baselineEvents[0]);
    assert.equal(verifyEvents(rows, CONFIG, { now: NOW, baselineCount: 10 }).ok, true);
    const report = await verifyConfigLive(CONFIG, async () => ({ success: true, concerts: rows }), {
      now: NOW, approvedArtistsPath, baselineCount: 10, baselineEvents
    });
    assert.equal(report.ok, false, formatVerifyReport(report));
    assert.equal(report.publicEventCount, 1);
    assert.match(formatVerifyReport(report), /no_public_volume_collapse/);
  });
});

test('live repair gate normalizes a captured Andrea Motis fixture through the native runner and public pipeline', async () => {
  const html = await readFile('tests/fixtures/artist-andrea-motis-agenda.html', 'utf8');
  const config = JSON.parse(await readFile('scrapers/artists/artist-andrea-motis.json', 'utf8')) as ScraperConfig;
  const server = createServer((_, response) => { response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    config.url = `http://127.0.0.1:${address.port}/agenda/`;
    await withApproved(async approvedArtistsPath => {
      const now = new Date('2026-09-20T00:00:00.000Z');
      const report = await verifyConfigLive(config, runScraper, { now, approvedArtistsPath });
      assert.equal(report.ok, true, formatVerifyReport(report));
      assert.equal(report.eventCount, 7);
      assert.equal(report.publicEventCount, 6, 'the unknown-country row stays incomplete');
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('missing approved catalogue cannot pass the live repair gate', async () => {
  await withApproved(async db => {
    const report = await verifyConfigLive(CONFIG, async () => ({ success: true, concerts: goodRows() }), {
      now: NOW, approvedArtistsPath: `${db}.missing`
    });
    assert.equal(report.ok, false);
    assert.equal(report.publicEventCount, 0);
  });
});

test('native live repair probes reject unsolicited 304, malformed API responses and a valid empty schedule', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/not-modified') { response.writeHead(304); response.end(); }
    else if (request.url === '/invalid-api') response.end('{broken json');
    else response.end('<p>No shows currently announced!</p>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await withApproved(async approvedArtistsPath => {
      for (const endpoint of ['not-modified', 'invalid-api', 'empty']) {
        const candidate: ScraperConfig = {
          ...CONFIG, url: `http://127.0.0.1:${address.port}/${endpoint}`, maxRetries: 0,
          type: endpoint === 'empty' ? 'static_selectors' : 'json_api',
          allowEmpty: endpoint === 'empty', emptyScheduleText: 'No shows currently announced!',
          selectors: { eventBlock: 'article', artist: 'h2', date: 'time',
            venueNameFallback: 'Concert Hall', cityNameFallback: 'Berlin', countryNameFallback: 'DE' }
        };
        const report = await verifyConfigLive(candidate, runScraper, { now: NOW, approvedArtistsPath });
        assert.equal(report.ok, false, `${endpoint}: ${formatVerifyReport(report)}`);
        assert.equal(report.eventCount, 0);
        assert.match(formatVerifyReport(report), endpoint === 'empty' ? /has_events/ : /live_fetch/);
      }
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
