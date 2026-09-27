import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

function row(overrides: Partial<Concert> = {}): Partial<Concert> {
  return {
    artist: 'Test Artist', date: '2026-11-21', city: 'Hannover', country: 'DE',
    venue: 'Kuppelsaal IM HCC', originalSource: 'official.example',
    scrapedAt: '2026-09-27T10:00:00.000Z', ...overrides
  };
}

async function processRows(rows: Partial<Concert>[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dedupe-metadata-'));
  try {
    const db = path.join(dir, 'artists.json');
    await fs.writeFile(db, JSON.stringify([{ name: 'Test Artist' }]));
    let report: ProcessingDiagnostics | undefined;
    const events = await processConcerts(rows, db, '2026-09-27T00:00:00.000Z', undefined, value => { report = value; });
    assert.ok(report);
    assert.equal(report.rawCount, report.publishedCount + report.duplicatesMerged);
    for (const source of Object.values(report.sources)) {
      assert.equal(source.rawCount, source.publishedCount + source.duplicatesMerged);
    }
    return { events, report };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('same-venue duplicate retains a complete source record in either source order', async () => {
  const sparse = row();
  const rich = row({ originalSource: 'feed.example', startTime: '20:00', lat: 52.376, lng: 9.768 });
  for (const rows of [[sparse, rich], [rich, sparse]]) {
    const { events, report } = await processRows(rows);
    assert.equal(events.length, 1);
    assert.equal(events[0].originalSource, 'feed.example');
    assert.equal(events[0].startTime, '20:00');
    assert.equal(events[0].lat, 52.376);
    assert.equal(events[0].lng, 9.768);
    assert.equal(report.sources['official.example'].duplicatesMerged, 1);
    assert.equal(report.sources['feed.example'].publishedCount, 1);
  }
});

test('a venue relocation keeps the current venue and never adopts old venue coordinates', async () => {
  // Official Beth Hart 21 November 2026 relocation: Swiss Life Hall -> Kuppelsaal.
  const { events } = await processRows([
    row(),
    row({ venue: 'Swiss Life Hall', originalSource: 'old-feed.example', startTime: '20:00', lat: 52.353, lng: 9.731 })
  ]);
  assert.equal(events[0].venue, 'Kuppelsaal IM HCC');
  assert.equal(events[0].originalSource, 'official.example');
  assert.equal(events[0].lat, undefined);
  assert.equal(events[0].lng, undefined);
});

test('country, time, and coordinate conflicts preserve the first complete record', async () => {
  const conflicts: [Partial<Concert>, Partial<Concert>][] = [
    [{}, { country: 'GB', startTime: '20:00' }],
    [{ startTime: '19:00' }, { startTime: '20:00', lat: 52.376, lng: 9.768 }],
    [{ lat: 52.376, lng: 9.768 }, { lat: 52.353, lng: 9.731, startTime: '20:00' }]
  ];
  for (const [first, second] of conflicts) {
    const { events } = await processRows([row(first), row({ ...second, originalSource: 'feed.example' })]);
    assert.equal(events[0].originalSource, 'official.example');
  }
});

test('metadata is never traded away to obtain another category or mixed between sources', async () => {
  const protectedFields: Partial<Concert>[] = [
    { startTime: '20:00' },
    { festival: { name: 'Festival' } },
    { lineup: ['Support Artist'] },
    { priceRange: { min: 20, max: 40, currency: 'EUR' } },
    { lat: 52.376 }
  ];
  for (const fields of protectedFields) {
    const { events } = await processRows([
      row(fields), row({ startTime: '21:00', lng: 9.768, originalSource: 'feed.example' })
    ]);
    assert.equal(events[0].originalSource, 'official.example');
    assert.equal(events[0].lng, undefined);
  }
});

test('ticket presence remains the primary choice and equal metadata preserves input order', async () => {
  const rich = row({ startTime: '20:00', lat: 52.376, lng: 9.768 });
  const linked = row({ ticketUrl: 'https://tickets.example/show', originalSource: 'linked.example' });
  for (const rows of [[rich, linked], [linked, rich]]) {
    const { events } = await processRows(rows);
    assert.equal(events[0].originalSource, 'linked.example');
  }
  const { events } = await processRows([row(), row({ originalSource: 'second.example' })]);
  assert.equal(events[0].originalSource, 'official.example');
  const partial = await processRows([row(), row({ lng: 9.768, originalSource: 'partial.example' })]);
  assert.equal(partial.events[0].originalSource, 'official.example', 'a single coordinate is not a usable location');
});
