/** Full saved-public-catalog replay; no scraping, DB writes or provider requests.
 * node --import tsx src/scripts/ru_location_normalization_replay.ts \
 *   --input /absolute/live-before/concerts.json --out /absolute/evidence/location-normalization \
 *   --baseline bc5e20d --clock 2026-10-18T09:04:35.710Z
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mock } from 'node:test';
import net from 'node:net';
import assert from 'node:assert/strict';
import { processConcerts } from '../pipeline/process.js';
import { geocodeConcerts, loadGeocodeCache, type GeocodeCache } from '../pipeline/geocode.js';
import { publishConcerts } from '../generator/publish.js';
import type { Concert } from '../schemas/concert.js';
import type { ProcessingDiagnostics } from '../observability/processing_diagnostics.js';
import { loadApprovedArtists } from '../pipeline/artistDb.js';
import { normalizeLocation } from '../pipeline/location.js';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
function git(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function main() {
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(process.argv[i]?.startsWith('--') && process.argv[i + 1], 'arguments must be --name value');
  options.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const input = options.get('input'), output = options.get('out'), clock = options.get('clock');
assert.ok(input && output && clock, 'required: --input concerts.json --out directory --clock saved-index.lastRun');
assert.ok(Number.isFinite(Date.parse(clock)), 'clock must be an ISO timestamp');
const out = path.resolve(output);
const baselineRef = git(['rev-parse', '--verify', options.get('baseline') ?? 'bc5e20d']);
const db = path.resolve(options.get('artists') ?? 'data/artists');
const artists = await loadApprovedArtists(db);
const aliases = new Map<string, string[]>(artists.filter(a => a && typeof a === 'object' && a.name)
  .map(a => [a.name, Array.isArray(a.aliases) ? a.aliases.filter((name: unknown): name is string => typeof name === 'string') : []]));
const inputBytes = await fs.readFile(input);
const rows: Concert[] = JSON.parse(inputBytes.toString('utf8'));
assert.ok(Array.isArray(rows) && rows.length, 'input must be the FULL saved concerts array');
const inputHash = sha(inputBytes);
const cacheFile = options.get('cache');
const cache: GeocodeCache = cacheFile ? await loadGeocodeCache(cacheFile) : {};
const cacheBefore = canonical(cache);
await fs.mkdir(out, { recursive: true });
const write = async (name: string, value: unknown) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw new Error('Network forbidden in saved-catalog replay'); };
mock.method(net.Socket.prototype, 'connect', blocked);
mock.method(globalThis, 'fetch', blocked);
const temporaryFiles: string[] = [];
try {
  // Baseline modules retain their relative imports and run against the exact
  // same approved DB, frozen clock, snapshot, cache and publisher as the candidate.
  async function baselineModule(name: string) {
    const file = path.resolve(`src/pipeline/.location-replay-${name}-${process.pid}.ts`);
    temporaryFiles.push(file);
    const contents = spawnSync('git', ['show', `${baselineRef}:src/pipeline/${name}.ts`], { encoding: 'utf8' });
    assert.equal(contents.status, 0, contents.stderr);
    await fs.writeFile(file, contents.stdout);
    return import(pathToFileURL(file).href);
  }
  const beforeProcess = await baselineModule('process');
  const beforeGeocode = await baselineModule('geocode');
  const transformed = rows.map(row => normalizeLocation(structuredClone(row), aliases.get(row.artist)));
  const transformStats = await geocodeConcerts(transformed, { cache: structuredClone(cache), maxPerRun: 0 });
  const types: Record<string, number> = {};
  const countries: Record<string, { modifiedRows: number; types: Record<string, number> }> = {};
  const examples: unknown[] = [];
  let modifiedRows = 0;
  const rowFile = await fs.open(path.join(out, 'rows-before-after.jsonl'), 'w');
  try {
    let batch: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const before = rows[i], after = transformed[i];
      assert.equal(before.artist, after.artist);
      assert.equal(before.date, after.date);
      assert.equal(before.country, after.country);
      for (const field of ['lat', 'lng'] as const) if (before[field] !== undefined) assert.equal(before[field], after[field]);
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(field => canonical(before[field as keyof Concert]) !== canonical(after[field as keyof Concert]));
      const allowed = new Set(['city', 'venue', 'venueKind', 'lat', 'lng']);
      assert.ok(fields.every(field => allowed.has(field)), `unexpected change at row ${i}: ${fields}`);
      const rowTypes = fields.map(field => ({ city: 'cityAliasOrCachedTranslation', venue: 'venuePlaceholder',
        venueKind: 'placeholderKindCleared', lat: 'cachedCoordinates', lng: 'cachedCoordinates' })[field]!);
      const distinctTypes = [...new Set(rowTypes)];
      if (fields.length) {
        modifiedRows++;
        const country = countries[before.country] ??= { modifiedRows: 0, types: {} };
        country.modifiedRows++;
        for (const type of distinctTypes) { types[type] = (types[type] ?? 0) + 1; country.types[type] = (country.types[type] ?? 0) + 1; }
        if (examples.length < 40) examples.push({ index: i, fields, before, after });
      }
      batch.push(JSON.stringify({ index: i, inputRowSha256: sha(canonical(before)),
        identity: [before.artist, before.date, before.country, before.originalSource, before.scrapedAt], fields, before, after }));
      if (batch.length === 256 || i === rows.length - 1) { await rowFile.write(batch.join('\n') + '\n'); batch = []; }
    }
  } finally { await rowFile.close(); }
  const repeated = structuredClone(transformed);
  await geocodeConcerts(repeated, { cache: structuredClone(cache), maxPerRun: 0 });
  assert.equal(canonical(repeated), canonical(transformed), 'row transformation must be idempotent');
  await write('row-transformation-counts.json', { inputRows: rows.length, outputRows: transformed.length, modifiedRows, types, countries, examples,
    newEvents: 0, explanation: 'Field corrections only; original row index/identity and full before/after preserved in rows-before-after.jsonl', transformStats });

  let beforeDiagnostics: ProcessingDiagnostics | undefined, afterDiagnostics: ProcessingDiagnostics | undefined;
  const before = await beforeProcess.processConcerts(structuredClone(rows), db, clock, undefined,
    (report: ProcessingDiagnostics) => { beforeDiagnostics = report; });
  await beforeGeocode.geocodeConcerts(before, { cache: structuredClone(cache), maxPerRun: 0 });
  const after = await processConcerts(structuredClone(rows), db, clock, undefined, report => { afterDiagnostics = report; });
  await geocodeConcerts(after, { cache: structuredClone(cache), maxPerRun: 0 });
  await publishConcerts(before, path.join(out, 'production-before'));
  await publishConcerts(after, path.join(out, 'production-after'));
  const normalizedBefore = (before as Concert[]).map(row => normalizeLocation(structuredClone(row), aliases.get(row.artist)));
  await geocodeConcerts(normalizedBefore, { cache: structuredClone(cache), maxPerRun: 0 });
  // Multisets compare complete rows after the explicit field correction, so
  // metadata changes cannot be mislabeled as additions/removals of events.
  const multiset = (values: Concert[]) => {
    const result = new Map<string, Concert[]>();
    for (const row of values) { const k = canonical(row); result.set(k, [...(result.get(k) ?? []), row]); }
    return result;
  };
  const remainingBefore = multiset(normalizedBefore), remainingAfter = multiset(after);
  const lost: Concert[] = [], gained: Concert[] = [];
  for (const k of new Set([...remainingBefore.keys(), ...remainingAfter.keys()])) {
    const a = remainingBefore.get(k) ?? [], b = remainingAfter.get(k) ?? [];
    lost.push(...a.slice(b.length)); gained.push(...b.slice(a.length));
  }
  await write('downstream-row-differences.json', { lost, gained, explanation: 'Complete output-row differences AFTER field corrections, not claims of new real-world events' });
  await write('production-diagnostics.json', { before: beforeDiagnostics, after: afterDiagnostics });
  const dbFiles = (await fs.stat(db)).isDirectory() ? (await fs.readdir(db)).filter(f => /^shard-\d+\.json$/.test(f)).sort().map(f => path.join(db, f)) : [db];
  const dbHashes = await Promise.all(dbFiles.map(async file => ({ file, sha256: sha(await fs.readFile(file)) })));
  assert.equal(canonical(cache), cacheBefore, 'source cache is immutable');
  assert.equal(networkAttempts, 0);
  await write('summary.json', { input: path.resolve(input), inputSha256: inputHash, inputRows: rows.length,
    revision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--short']).split('\n').filter(line => !line.includes('/.location-replay-')).join('\n'), baselineRef, clock, approvedDb: dbHashes,
    cache: cacheFile ? { file: path.resolve(cacheFile), sha256: sha(await fs.readFile(cacheFile)) } : 'empty cache: no saved cache supplied; no coordinate guesses',
    networkAttempts, rowTransformation: { modifiedRows, outputRows: transformed.length, types, countries },
    production: { beforeRows: before.length, afterRows: after.length,
      beforeDuplicates: beforeDiagnostics?.duplicatesMerged, afterDuplicates: afterDiagnostics?.duplicatesMerged,
      lostOutputRowsAfterFieldCorrections: lost.length, gainedOutputRowsAfterFieldCorrections: gained.length },
    notes: ['All snapshot rows replayed; past-date/approval validation and dedupe reported separately in production-diagnostics.json.',
      'Publisher groups nearby cities in its existing index; concerts.json retains the normalized settlement.',
      'This saved-public-input replay cannot recover events already rejected upstream of publication. Native BIT fixture regression covers recovery.'] });
  console.log(JSON.stringify({ inputRows: rows.length, modifiedRows, types, countries, beforeRows: before.length, afterRows: after.length,
    downstreamLostRows: lost.length, downstreamGainedRows: gained.length, networkAttempts }, null, 2));
} finally {
  await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })));
  mock.restoreAll();
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
