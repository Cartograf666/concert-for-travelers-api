import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

const observedAt = '2026-10-06T21:26:20.449Z';
const nitschMbid = 'cbadeb12-bb3c-490f-95f4-f6444c111f32';
type Proof = { raw: Partial<Concert>[]; verifiedOtherSource: Partial<Concert> };

async function proof(): Promise<Proof> {
  return JSON.parse(await readFile('tests/fixtures/nitsch-source-provenance.json', 'utf8')) as Proof;
}

async function withApproved(fn: (db: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'nitsch-provenance-'));
  const db = join(dir, 'approved.json');
  try {
    await writeFile(db, JSON.stringify([
      { name: 'Hermann Nitsch', aliases: ['Herman Nitsch'], mbid: nitschMbid, website: 'http://www.nitsch.org/' },
      { name: 'Evgeny Kissin', mbid: 'e19df94c-f95c-477c-b54b-d6374a38d4da' },
      { name: 'Other Artist', mbid: '11111111-1111-4111-8111-111111111111' }
    ]));
    await fn(db);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('captured Nitsch exhibition endpoints and uncredited quartet do not publish; verified Kissin recital remains', async () => {
  const { raw, verifiedOtherSource } = await proof();
  assert.deepEqual(raw.map(row => [row.date, row.city]), [
    ['21.3—29.11.2026', 'Mistelbach'],
    ['18.1—12.4.2026', 'Margate'],
    ['11.10.2026', 'Gibellina']
  ]);
  const untouched = structuredClone(raw);
  await withApproved(async db => {
    let diagnostics: ProcessingDiagnostics | undefined;
    const published = await processConcerts([...raw, verifiedOtherSource], db, observedAt,
      undefined, report => { diagnostics = report; });
    assert.deepEqual(published.map(row => [row.artist, row.date, row.venue, row.city]), [
      ['Evgeny Kissin', '2027-04-30', 'Joseph Meyerhoff Symphony Hall', 'Baltimore']
    ]);
    assert.equal(diagnostics?.rawCount, 4);
    assert.equal(diagnostics?.publishedCount, 1);
    assert.equal(diagnostics?.dropped.notApproved, 3);
    assert.equal(diagnostics?.dropped.badDate, 0);
    assert.deepEqual(raw, untouched, 'last-good source cache is not rewritten');
  });
});

test('apex Nitsch source rejects a date period before the permissive date parser', async () => {
  const { raw } = await proof();
  await withApproved(async db => {
    const periods = [
      { ...raw[0], originalSource: 'nitsch.org' },
      { ...raw[0], date: '21.3–29.11.2026' },
      { ...raw[0], date: '21.3-29.11.2026' },
      { ...raw[0], date: '21.3.2026-29.11.2026' },
      { ...raw[0], date: '21.3.2026 - 29.11.2026' },
      { ...raw[0], date: '21.3.-29.11.2026' }
    ];
    let diagnostics: ProcessingDiagnostics | undefined;
    assert.deepEqual(await processConcerts(periods, db, observedAt,
      undefined, report => { diagnostics = report; }), []);
    assert.equal(diagnostics?.dropped.notApproved, periods.length);
  });
});

test('exact uncredited-row quarantine preserves future single dates, other sources, artists and venues', async () => {
  const { raw } = await proof();
  const quartet = raw[2];
  const alternatives: Partial<Concert>[] = [
    { ...quartet, date: '11.10.2027' },
    { ...quartet, originalSource: 'other.example' },
    { ...quartet, artist: 'Other Artist' },
    { ...quartet, venue: 'Verified New Music Hall' },
    { ...quartet, city: 'Palermo' }
  ];
  await withApproved(async db => {
    for (const row of alternatives) {
      const result = await processConcerts([row], db, observedAt);
      assert.equal(result.length, 1, `${row.artist} ${row.date} ${row.city} ${row.originalSource}`);
    }
    const sameRowFromApex = { ...quartet, originalSource: 'nitsch.org' };
    assert.deepEqual(await processConcerts([sameRowFromApex], db, observedAt), []);
    assert.deepEqual(await processConcerts([{ ...quartet, artist: 'Herman Nitsch' }], db, observedAt), [],
      'canonical Nitsch alias must not evade the same exact uncredited listing');
    const isoSingle = { ...quartet, date: '2026-10-11' };
    assert.equal((await processConcerts([isoSingle], db, observedAt)).length, 1,
      'an ordinary single ISO date must remain publishable');
  });
});
