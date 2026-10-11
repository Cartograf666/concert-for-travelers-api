import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { processConcerts } from '../src/pipeline/process.js';
import { mozarteumProvenanceDropReason } from '../src/pipeline/mozarteum_provenance.js';
import type { RawConcert } from '../src/schemas/concert.js';
const NOW = '2026-10-10T10:54:07.538Z';
async function native(): Promise<RawConcert> {
  const fixture = JSON.parse(await readFile('tests/fixtures/mozarteum-requiem-provenance-20261011.json','utf8'));
  assert.equal(fixture.nativeEvent.concertLocationTimes[0].date,'2026-12-05');
  assert.match(fixture.nativeEvent.infoEn,/<strong>Mozart<\/strong><br>Requiem in D minor, KV 626/);
  return fixture.rawContract;
}

test('primary Requiem full native date and same-site event provenance survives actual approved catalogue', async () => {
  const raw = await native(), before = structuredClone(raw);
  assert.equal(mozarteumProvenanceDropReason(raw),undefined);
  const result = await processConcerts([raw],'data/artists',NOW);
  assert.equal(result.length,1);
  assert.equal(result[0].artist,'Wolfgang Amadeus Mozart');
  assert.equal(result[0].date,'2026-12-05');
  assert.equal(result[0].startTime,'19:00');
  assert.equal(result[0].venue,'Stiftung Mozarteum, Grosser Saal');
  assert.equal(result[0].country,'AT');
  assert.deepEqual(raw,before);
});

test('legacy yearless/range/invalid dates are badDate before permissive parsing, without source mutation', async () => {
  const raw = await native();
  const rows = ['05.12','5 December','5 December 2026','2026-12-05 to 2026-12-06','2026-02-30',' 2026-12-05']
    .map(date => ({...raw,date}));
  const before = structuredClone(rows);
  for (const row of rows) assert.equal(mozarteumProvenanceDropReason(row),'badDate');
  let count = 0;
  assert.deepEqual(await processConcerts(rows,'data/artists',NOW,undefined,r => {count = r.dropped.badDate;}),[]);
  assert.equal(count,rows.length);
  assert.deepEqual(rows,before);
});

test('missing/unsafe/unrelated programme provenance does not validate legacy blanket composer rows', async () => {
  const raw = await native();
  const rows = [undefined,'https://mozarteum.at/konzerte','https://mozarteum.at/page-data/konzerte/page-data.json',
    'https://mozarteum.at.evil.example/en/events/requiem','https://other.example/en/events/requiem',
    'http://mozarteum.at/en/events/requiem','https://user:pass@mozarteum.at/en/events/requiem',
    'https://mozarteum.at:8443/en/events/requiem','https://mozarteum.at/en/events/requiem?unverified=1',
    'https://mozarteum.at/en/events/requiem#different','https://mozarteum.at/en/events/requiem/other']
    .map(sourceEventUrl => ({...raw,sourceEventUrl}));
  for (const row of rows) assert.equal(mozarteumProvenanceDropReason(row),'notApproved');
  let count = 0;
  assert.deepEqual(await processConcerts(rows,'data/artists',NOW,undefined,r => {count = r.dropped.notApproved;}),[]);
  assert.equal(count,rows.length);
});

test('Mozarteum scope is exact normalized host; other Mozart sources remain unchanged and URL does not bypass approval', async () => {
  const raw = await native();
  const invalid = {...raw,date:'5 December'};
  for (const originalSource of [' MOZARTEUM.AT ','www.mozarteum.at']) {
    assert.equal(mozarteumProvenanceDropReason({...invalid,originalSource}),'badDate');
  }
  const other = ['artist.example','mozarteum.at.evil.example','fakemozarteum.at']
    .map(originalSource => ({...invalid,originalSource}));
  for (const row of other) assert.equal(mozarteumProvenanceDropReason(row),undefined);
  const expected = await processConcerts(other,'data/artists',NOW);
  assert.equal(expected.length,1,'Existing cross-source dedupe remains unchanged');
  assert.equal(expected[0].artist,raw.artist);
  assert.equal(expected[0].date,'2026-12-05');
  assert.deepEqual(await processConcerts([invalid,...other],'data/artists',NOW),expected);
  assert.deepEqual(await processConcerts([{...raw,artist:'Unapproved Fixture Performer 987654321'}],'data/artists',NOW),[]);
});
