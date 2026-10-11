// Offline full-original/fixture and six-order whole-record replay. No live providers.
// node --import tsx tests/normalization_integrity_replay.mjs <original-evidence-dir> <output-dir> <1758848-review-worktree>
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const [input, output, baselineRoot] = process.argv.slice(2);
assert.ok(input && output && baselineRoot);
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const axios = require('axios');
const { runScraper } = await import(path.join(root, 'src/engine/runner.ts'));
const { processConcerts, slugify } = await import(path.join(root, 'src/pipeline/process.ts'));
const { processConcerts: baselineProcess } = await import(path.join(baselineRoot, 'src/pipeline/process.ts'));
const { ScraperConfigSchema } = await import(path.join(root, 'src/schemas/config.ts'));
const fixtureDir = path.join(root, 'tests/fixtures/normalization-location-20261011');
const proof = JSON.parse(await fs.readFile(path.join(fixtureDir, 'proof.json'), 'utf8'));
const at = proof.baseDate;
mock.timers.enable({ apis: ['Date'], now: Date.parse(at) });
let networkAttempts = 0;
const blocked = () => { networkAttempts++; throw new Error('External network forbidden in integrity replay'); };
net.Socket.prototype.connect = blocked;
dns.lookup = blocked;
dns.promises.lookup = blocked;
globalThis.fetch = blocked;
process.env.SCRAPER_HTTP_BACKEND = 'axios';
await fs.mkdir(output, { recursive: true });
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const db = path.join(root, 'data/artists');
async function extract(config, body) {
  axios.get = async url => { assert.equal(url, config.url); return { status: 200, data: body, headers: {} }; };
  const result = await runScraper(config);
  assert.equal(result.success, true, `${config.id}: ${result.error}`);
  return result.concerts;
}
const beforeRaw = [], reviewedRaw = [], afterRaw = [], peers = [], parity = [];
for (const [id, entry] of Object.entries(proof.sources)) {
  const savedText = await fs.readFile(path.join(input, `${id}-final-replay.json`), 'utf8');
  const saved = JSON.parse(savedText);
  beforeRaw.push(...saved.beforeRaw); reviewedRaw.push(...saved.afterRaw);
  const config = ScraperConfigSchema.parse(JSON.parse(await fs.readFile(path.join(root, entry.configPath), 'utf8')));
  const fullFile = id === 'artist-shelly-berg' ? id + '-native.json' : id + '.html';
  const full = await fs.readFile(path.join(input, fullFile), 'utf8');
  const fixture = await fs.readFile(path.join(fixtureDir, id + (id === 'artist-shelly-berg' ? '.json' : '.html')), 'utf8');
  const rows = await extract(config, full);
  assert.deepEqual(await extract(config, fixture), rows, id);
  afterRaw.push(...rows);
  const slug = id.replace(/^artist-/, '');
  const meta = JSON.parse(await fs.readFile(path.join(input, `${slug}-public-meta.json`), 'utf8'));
  if (meta.result.startsWith('200 ')) peers.push(...JSON.parse(await fs.readFile(path.join(input, `${slug}-public.json`), 'utf8')));
  else assert.ok(meta.result.startsWith('404 '));
  parity.push({ id, unchangedSavedRawSha256: hash(savedText), fullSha256: hash(full), fixtureSha256: hash(fixture), fixtureRawDeepEqualsFull: true, beforeRaw: saved.beforeRaw.length, reviewedRaw: saved.afterRaw.length, correctedRaw: rows.length });
}
await write('raw-inputs.json', { at, beforeRaw, reviewedRaw, correctedRaw: afterRaw, peers, parity });
const tm = peers.filter(r => r.originalSource === 'ticketmaster.com');
const bit = peers.filter(r => r.originalSource === 'bandsintown.com');
const other = peers.filter(r => !['ticketmaster.com', 'bandsintown.com'].includes(r.originalSource));
const orders = [['tm','native','bit'],['tm','bit','native'],['native','tm','bit'],['native','bit','tm'],['bit','tm','native'],['bit','native','tm']];
const key = r => `${slugify(r.artist)}_${r.date}_${slugify(r.city)}`;
function delta(before, after) {
  const next = new Map(after.map(r => [key(r),r]));
  const old = new Map(before.map(r => [key(r),r]));
  const equalExceptTimestamp = (a,b) => JSON.stringify({ ...a, scrapedAt: '' }) === JSON.stringify({ ...b, scrapedAt: '' });
  return { removed: before.filter(r => !next.has(key(r))), added: after.filter(r => !old.has(key(r))),
    changed: before.filter(r => next.has(key(r)) && !equalExceptTimestamp(r,next.get(key(r)))).map(r => ({ key: key(r), before: r, after: next.get(key(r)) })) };
}
const summary = { at, networkAttempts, orders: [], parity, limitation: 'Observed public snapshots are peer inputs, not raw provider caches/full production composition.' };
const sourceBefore = await baselineProcess(beforeRaw, db, at);
const sourceReviewed = await baselineProcess(reviewedRaw, db, at);
const preexisting = new Set(delta(sourceBefore,sourceReviewed).changed.map(d => d.key));
const sourceAfter = await processConcerts(afterRaw, db, at);
await write('source-only.json', { before: sourceBefore, reviewed: sourceReviewed, corrected: sourceAfter });
for (const order of orders) {
  const composition = native => [...other, ...order.flatMap(s => s === 'tm' ? tm : s === 'bit' ? bit : native)];
  const before = await baselineProcess(composition(beforeRaw),db,at);
  const reviewed = await baselineProcess(composition(reviewedRaw),db,at);
  const corrected = await processConcerts(composition(afterRaw),db,at);
  const introduced = delta(before,reviewed).changed.filter(d => !preexisting.has(d.key));
  const correctedDelta = delta(before,corrected);
  const reviewedDelta = delta(reviewed,corrected);
  const filename = order.join('-') + '.json';
  await write(filename, { order, before, reviewed, corrected, introducedReviewedReplacements: introduced, correctedDelta, reviewedDelta });
  summary.orders.push({ order, before:before.length, reviewed:reviewed.length, corrected:corrected.length, introducedReviewedReplacements:introduced.length,
    correctedChanged:correctedDelta.changed.map(d => d.key), correctedAdded:correctedDelta.added.map(key), correctedRemoved:correctedDelta.removed.map(key), file:filename });
  if (order.join('-') === 'tm-native-bit') assert.equal(introduced.length,32);
  if (order.join('-') === 'native-tm-bit') assert.equal(introduced.length,39);
  const pairProof = JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/normalization-integrity-20261011/occurrence-proof.json'),'utf8'));
  for (const pair of pairProof.pairs) {
    const n = afterRaw.find(r => r.artist===pair.artist && r.date===pair.date && r.venue===pair.nativeVenue);
    assert.ok(n);
    const expected = await processConcerts([pair.winner==='native' ? n : pair.before],db,at);
    const actual = corrected.filter(r => r.artist===pair.artist && r.date===pair.date && r.city===pair.nativeCity);
    assert.deepEqual(actual,expected,`${filename}: ${pair.artist}/${pair.date}`);
    if (pair.nativeCity !== pair.peerCity) assert.equal(corrected.some(r => r.artist===pair.artist && r.date===pair.date && r.city===pair.peerCity),false);
  }
}
summary.networkAttempts = networkAttempts;
assert.equal(networkAttempts,0);
await write('summary.json',summary);
console.log(JSON.stringify({ networkAttempts, orders:summary.orders.map(({file,...row}) => row) },null,2));
mock.timers.reset();
