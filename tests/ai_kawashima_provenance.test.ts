import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { processConcerts } from '../src/pipeline/process.js';
import type { Concert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

const mbid = '6d7ef4a5-26c9-45e7-ad19-24ec48c50ed4';
const observedAt = '2026-10-07T07:40:00.000Z';
async function withDb(fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-provenance-'));
  try {
    const path = join(dir, 'artists.json');
    await writeFile(path, JSON.stringify([
      { name: 'Ai Kawashima', aliases: ['川嶋あい'], mbid, website: 'https://kawashimaai.com' },
      { name: 'Other Artist', mbid: '11111111-1111-4111-8111-111111111111' }
    ]));
    await fn(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function raw(): Promise<Partial<Concert>[]> {
  return (JSON.parse(await readFile('tests/fixtures/ai-kawashima-legacy-cache-20261007.json', 'utf8')) as
    { raw: Partial<Concert>[] }).raw;
}

test('captured legacy cache cannot republish prefectures and headlines as Ai concert geography', async () => {
  const rows = await raw();
  const before = structuredClone(rows);
  await withDb(async db => {
    let diagnostic: ProcessingDiagnostics | undefined;
    const published = await processConcerts(rows, db, observedAt, undefined, report => { diagnostic = report; });
    assert.deepEqual(published, []);
    assert.equal(diagnostic?.dropped.notApproved, 2);
    assert.equal(diagnostic?.dropped.pastDate, 1);
    assert.deepEqual(rows, before);
  });
});

test('exact legacy quarantine retains corrected venues/cities, other dates, sources and canonical artists', async () => {
  const rows = await raw();
  await withDb(async db => {
    for (const row of rows.slice(1)) {
      const corrected = { ...row, venue: row.city === '千葉' ? 'イオンタウンユーカリが丘' : '太田川駅前 大屋根広場',
        city: row.city === '千葉' ? 'Sakura' : 'Tokai' };
      const alternatives = [corrected, { ...row, date: '2027-11-15' },
        { ...row, originalSource: 'other.example' }, { ...row, artist: 'Other Artist' },
        { ...row, venue: 'Verified New Hall' }, { ...row, country: 'US' }];
      for (const event of alternatives) assert.equal((await processConcerts([event], db, observedAt)).length, 1);
      assert.deepEqual(await processConcerts([{ ...row, artist: '川嶋あい' }], db, observedAt), []);
    }
  });
});
