import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FAME_CANDIDATES, aggregateConcerts, buildCalibrationReport, classifyListeners,
  main, normalizeArtistName, parseCalibrationArgs, runCalibration
} from '../src/scripts/calibrate_artist_fame.js';

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fame-calibration-test-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('fame calibration classifies all boundaries and invalid listener values', () => {
  const [veryLarge, large, medium] = FAME_CANDIDATES.balanced;
  assert.equal(classifyListeners(veryLarge, FAME_CANDIDATES.balanced), 'very-large');
  assert.equal(classifyListeners(large, FAME_CANDIDATES.balanced), 'large');
  assert.equal(classifyListeners(medium, FAME_CANDIDATES.balanced), 'medium');
  assert.equal(classifyListeners(medium - 1, FAME_CANDIDATES.balanced), 'small');
  for (const value of [0, -1, NaN, Infinity, undefined, '100000']) assert.equal(classifyListeners(value, FAME_CANDIDATES.balanced), 'unknown');
});

test('fame calibration reports are stable across artist input order', () => {
  const artists = [
    { name: ' Zed ', popularity: { listeners: 10_000 }, wikidataSitelinks: 2, genres: ['rock'] },
    { name: 'Alpha', popularity: { listeners: 1_000_000 }, genres: ['pop'] }
  ];
  assert.deepStrictEqual(buildCalibrationReport(artists), buildCalibrationReport([...artists].reverse()));
  assert.equal(normalizeArtistName('  A\u00a0B  '), 'a b');
});

test('concert aggregation keeps every snapshot row, flags ambiguity, and includes unknown only in all', () => {
  const artists = buildCalibrationReport([
    { name: 'Known', popularity: { listeners: 100_000 }, genres: ['jazz fusion', 'Pop'] },
    { name: 'Duplicate' }, { name: ' duplicate ' }, { name: 'Unknown' }
  ]).artists;
  const concerts = [
    { artist: 'KNOWN', date: '2026-09-11' },
    { artist: 'Unknown', date: '2026-09-12' },
    { artist: 'duplicate', date: '2026-09-12' },
    { artist: 'Absent', date: '2026-09-12' },
    { artist: 'Known', date: '2026-09-10' }
  ];
  const before = JSON.stringify(concerts);
  const result = aggregateConcerts(concerts, artists, '2026-09-11');
  assert.equal(JSON.stringify(concerts), before, 'calibration must not remove or mutate concerts');
  assert.deepStrictEqual(result, aggregateConcerts([...concerts].reverse(), artists, '2026-09-11'), 'snapshot ordering must not change the report');
  assert.equal(result.activeConcertCount, 4);
  assert.equal(result.matchedConcertCount, 2);
  assert.equal(result.unmatchedConcertCount, 2);
  assert.equal(result.unmatchedActiveConcertNames.find((row) => row.name === 'duplicate')!.reason, 'ambiguous-name');
  assert.deepStrictEqual(result.retentionByCandidate.balanced, { top2: 1, top3: 1, all: 4 });
  assert.equal(result.genreTagCohorts.jazz.matchedActiveConcerts, 1, 'non-pop cohort tags are substring matches');
  assert.equal(result.genreTagCohorts.pop.matchedActiveConcerts, 1, 'pop is an explicit tag, not a substring or nationality inference');
});

test('CLI helper reads inputs without mutating DB or concert snapshot and validates as-of pairing', async () => {
  await withTempDir(async (root) => {
    const dbPath = path.join(root, 'artists.json');
    const concertsPath = path.join(root, 'concerts.json');
    const outputPath = path.join(root, 'out', 'report.json');
    await fs.writeFile(dbPath, JSON.stringify([{ name: 'A', popularity: { listeners: 25_000 } }]));
    await fs.writeFile(concertsPath, JSON.stringify([{ artist: 'A', date: '2026-09-11' }]));
    const beforeDb = await fs.readFile(dbPath, 'utf8');
    const beforeConcerts = await fs.readFile(concertsPath, 'utf8');
    await main(['--artist-db', dbPath, '--concerts', concertsPath, '--as-of', '2026-09-11', '--output', outputPath]);
    const report = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(report.concerts.matchedConcertCount, 1);
    assert.equal(await fs.readFile(dbPath, 'utf8'), beforeDb);
    assert.equal(await fs.readFile(concertsPath, 'utf8'), beforeConcerts);
    assert.throws(() => parseCalibrationArgs(['--concerts', concertsPath]), /--as-of/);
    assert.throws(() => parseCalibrationArgs(['--as-of', '2026-09-11']), /only valid/);
    await assert.rejects(() => runCalibration({ artistDbPath: dbPath, concertsPath, outputPath: dbPath, asOf: '2026-09-11' }), /must not overwrite/);
    await assert.rejects(() => runCalibration({ artistDbPath: dbPath, concertsPath, outputPath: concertsPath, asOf: '2026-09-11' }), /must not overwrite/);
    const dbDir = path.join(root, 'artist-dir');
    await fs.mkdir(dbDir);
    await fs.writeFile(path.join(dbDir, 'shard-0.json'), '[]');
    await assert.rejects(() => runCalibration({ artistDbPath: dbDir, outputPath: path.join(dbDir, 'report.json') }), /must not overwrite/);
  });
});
