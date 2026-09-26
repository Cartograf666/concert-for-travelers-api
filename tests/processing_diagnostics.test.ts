import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { processConcerts } from '../src/pipeline/process.js';
import { processingDiagnosticsSummary } from '../src/observability/processing_diagnostics.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';
import type { Concert } from '../src/schemas/concert.js';

async function withApprovedArtists(fn: (approvedArtistsPath: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'processing-diagnostics-test-'));
  try {
    const approvedArtistsPath = path.join(dir, 'approved_artists.json');
    await fs.writeFile(approvedArtistsPath, JSON.stringify([{ name: 'Approved Artist' }]), 'utf8');
    await fn(approvedArtistsPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function raw(overrides: Partial<Concert> = {}): Partial<Concert> {
  return {
    artist: 'Approved Artist',
    date: '2026-10-12',
    venue: 'Club Arena',
    city: 'Berlin',
    country: 'DE',
    originalSource: 'safe.example',
    scrapedAt: '2026-09-01T12:00:00.000Z',
    ...overrides
  };
}

test('processing diagnostics are observational, reconcile every processing outcome, and expose actionable aggregates', async () => {
  await withApprovedArtists(async (approvedArtistsPath) => {
    const input: Partial<Concert>[] = [
      raw(),
      raw({ originalSource: 'https://user:pass@site.test/path?apikey=secret', ticketUrl: 'https://tickets.example/show' }),
      raw({ country: '', originalSource: 'incomplete.example' }),
      raw({ artist: 'Unknown 1', originalSource: '__proto__' }),
      raw({ artist: 'Unknown 2', originalSource: 'unknown-two.example' }),
      raw({ artist: 'Unknown 3', originalSource: 'unknown-three.example' }),
      raw({ artist: 'Unknown 4', originalSource: 'unknown-four.example' }),
      raw({ date: 'no usable date', originalSource: 'bad-date.example' }),
      raw({ date: '2026-01-01', originalSource: 'past.example' }),
      raw({ lat: 91, originalSource: 'invalid-lat.example' })
    ];
    const baseDate = '2026-09-01T00:00:00.000Z';
    const withoutDiagnostics = await processConcerts(input, approvedArtistsPath, baseDate);
    let report: ProcessingDiagnostics | undefined;
    const withDiagnostics = await processConcerts(input, approvedArtistsPath, baseDate, undefined, (value) => { report = value; });

    assert.deepStrictEqual(withDiagnostics, withoutDiagnostics, 'the callback must not change output or dedupe selection');
    assert.ok(report);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.baseDate, baseDate);
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(report.rawCount, 10);
    assert.equal(report.publishedCount, 1);
    assert.equal(report.duplicatesMerged, 1);
    assert.deepStrictEqual(report.dropped, { incomplete: 1, notApproved: 4, badDate: 1, pastDate: 1, zodFail: 1 });
    assert.equal(report.rawCount, report.publishedCount + report.duplicatesMerged + Object.values(report.dropped).reduce((sum, count) => sum + count, 0));
    for (const source of Object.values(report.sources)) {
      assert.equal(
        source.rawCount,
        source.publishedCount + source.duplicatesMerged + Object.values(source.dropped).reduce((sum, count) => sum + count, 0),
        'each normalized source must reconcile independently'
      );
    }
    assert.equal(report.missingFields.country, 1);
    assert.equal(report.sources['__proto__'].dropped.notApproved, 1, 'untrusted source keys must not affect object behavior');
    assert.equal(report.sources['safe.example'].duplicatesMerged, 1, 'a replaced original owns the duplicate outcome');
    assert.equal(report.sources['safe.example'].rawCount, 1);
    assert.equal(report.sources['safe.example'].publishedCount, 0);
    assert.equal(report.sources['site.test'].rawCount, 1, 'a URL source is reduced to a hostname');
    assert.equal(report.sources['site.test'].duplicatesMerged, 0);
    assert.equal(report.sources['site.test'].publishedCount, 1, 'the replacement record remains the published source');
    const serializedReport = JSON.stringify(report);
    assert.equal(serializedReport.includes('user:pass'), false);
    assert.equal(serializedReport.includes('apikey=secret'), false);
    assert.equal(serializedReport.includes('/path'), false);
    assert.equal(JSON.stringify(processingDiagnosticsSummary(report)).includes('apikey=secret'), false);
    assert.equal(Object.entries(report.validationIssues).filter(([key]) => key.startsWith('lat:')).length, 1, 'field-specific Zod issue must be counted');
    assert.equal(report.samples.filter((sample) => sample.reason === 'notApproved').length, 3, 'samples are capped per reason');
    assert.ok(report.samples.length <= 15, 'samples have a global hard cap');
    assert.equal('samples' in processingDiagnosticsSummary(report), false, 'the public status summary never includes diagnostic examples');
    for (const sample of report.samples) {
      assert.deepStrictEqual(Object.keys(sample).sort(), Object.keys(sample).filter((key) => ['reason', 'artist', 'date', 'venue', 'city', 'country', 'originalSource'].includes(key)).sort());
    }
  });
});

test('processing diagnostics report a meaningful empty batch', async () => {
  await withApprovedArtists(async (approvedArtistsPath) => {
    let report: ProcessingDiagnostics | undefined;
    const output = await processConcerts([], approvedArtistsPath, '2026-09-01T00:00:00.000Z', undefined, (value) => { report = value; });
    assert.deepStrictEqual(output, []);
    assert.ok(report);
    assert.equal(report.rawCount, 0);
    assert.equal(report.publishedCount, 0);
    assert.equal(report.duplicatesMerged, 0);
    assert.deepStrictEqual(report.dropped, { incomplete: 0, notApproved: 0, badDate: 0, pastDate: 0, zodFail: 0 });
    assert.deepStrictEqual(Object.keys(report.sources), []);
  });
});
