import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

const mbid = '98a819b7-2634-4987-815b-bc66182dc97f';
const baseDate = '2026-10-07T07:00:00Z';
const canonical = { name: 'Twin Atlantic', mbid };
async function proof(): Promise<{ published: Partial<Concert>[]; bandsintown: Partial<Concert>[] }> {
  return JSON.parse(await readFile('tests/fixtures/twin-atlantic-cancellations-20261007.json', 'utf8'));
}
async function withDb(artists: unknown[], fn: (db: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'twin-cancellations-'));
  try {
    const db = join(dir, 'artists.json');
    await writeFile(db, JSON.stringify(artists));
    await fn(db);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('six confirmed Twin Atlantic cancellations stay absent when old provider caches are reused; Leeds remains', async () => {
  const { published, bandsintown } = await proof();
  const raw = [...published, ...bandsintown], untouched = structuredClone(raw);
  await withDb([canonical], async db => {
    let diagnostics: ProcessingDiagnostics | undefined;
    const result = await processConcerts(raw, db, baseDate, undefined, value => { diagnostics = value; });
    assert.deepEqual(result.map(row => [row.date, row.city, row.venue]), [['2026-10-16', 'Leeds', 'Stylus']]);
    assert.equal(diagnostics?.dropped.notApproved, 12);
    assert.equal(diagnostics?.rawCount, 14);
    assert.equal(diagnostics?.publishedCount, 1);
    assert.deepEqual(raw, untouched, 'the last-good provider cache is preserved');
  });
});

test('cancellation guard preserves another date, venue, city, country and canonical identity', async () => {
  const { published } = await proof();
  const cancelled = published[1];
  const alternatives = [
    { ...cancelled, date: '2027-10-17' },
    { ...cancelled, venue: 'Another Hall' },
    { ...cancelled, city: 'Leeds' },
    { ...cancelled, country: 'US' },
    { ...cancelled, artist: 'Other Artist' }
  ];
  await withDb([canonical, { name: 'Other Artist' }], async db => {
    for (const row of alternatives) assert.equal((await processConcerts([row], db, baseDate)).length, 1);
  });
  await withDb([{ name: canonical.name, mbid: '11111111-1111-4111-8111-111111111111' }], async db => {
    assert.equal((await processConcerts([cancelled], db, baseDate)).length, 1);
  });
  await withDb([{ ...canonical, aliases: ['TwinAtlantic'] }], async db => {
    assert.equal((await processConcerts([{ ...cancelled, artist: 'TwinAtlantic', date: '17 October 2026' }], db, baseDate)).length, 0);
  });
});
