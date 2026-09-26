import test from 'node:test';
import assert from 'node:assert/strict';
import { probeBatch } from '../src/scripts/discover_tour_urls.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { discoverWithCheckpoint, type DiscoveryOptions, atomicDiscoveryJson } from '../src/scripts/tourUrlDiscoveryCheckpoint.js';
import { loadApprovedArtists, saveApprovedArtists } from '../src/pipeline/artistDb.js';
import { selectProbeQueue, isTourUrlProbeCandidate } from '../src/scripts/discover_tour_urls.js';
import type { ArtistEntry } from '../src/schemas/artist.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fsPromises from 'node:fs/promises';

async function fixture(t: test.TestContext, count = 12) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tour-discovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'artists.json');
  const artists: ArtistEntry[] = Array.from({ length: count }, (_, i) => ({ name: `Artist ${String(i).padStart(2, '0')}`, website: `https://artist${i}.example.org`, tier: 'professional' } as ArtistEntry));
  await saveApprovedArtists(db, artists);
  const calls: string[] = [];
  let writes = 0;
  const options: DiscoveryOptions = {
    mode: 'run', limit: count,
    checkpointFile: path.join(dir, 'checkpoint.json'),
    resultsFile: path.join(dir, 'results.json'),
    auditFile: path.join(dir, 'audit.json'),
    loadDb: () => loadApprovedArtists(db),
    saveDb: async (rows) => { writes++; await saveApprovedArtists(db, rows); },
    select: selectProbeQueue,
    eligible: isTourUrlProbeCandidate,
    probeSlice: async candidates => candidates.map(c => {
      calls.push(c.name);
      return { ...c, tourUrl: `${c.website}/tour`, pathPattern: '/tour', reason: 'fixture' };
    }),
  };
  return { dir, db, artists, options, calls, writes: () => writes };
}

test('run retains completed first slice, resumes pending only, and merges fresh DB fields', async t => {
  const f = await fixture(t);
  const probe = f.options.probeSlice;
  f.options.probeSlice = async candidates => {
    if (f.calls.length) {
      const rows = await f.options.loadDb();
      rows[0].mbid = 'fresh-neighbour-field';
      await saveApprovedArtists(f.db, rows);
      throw new Error('interrupted after first slice');
    }
    return probe(candidates);
  };
  await assert.rejects(discoverWithCheckpoint(f.options), /interrupted/);
  assert.equal((await f.options.loadDb()).filter(a => a.tourUrl).length, 10);
  assert.equal(JSON.parse(await fs.readFile(f.options.resultsFile!, 'utf-8')).length, 10);
  f.options.probeSlice = probe;
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 12);
  assert.equal(new Set(f.calls).size, 12);
  assert.equal((await f.options.loadDb())[0].mbid, 'fresh-neighbour-field');
  assert.equal(JSON.parse(await fs.readFile(f.options.auditFile, 'utf-8')).length, 12);
  await discoverWithCheckpoint(f.options); // completed run starts a new empty batch
  assert.equal(f.calls.length, 12);
});

for (const boundary of ['checkpoint', 'results', 'db', 'audit'] as const) {
  test(`resume after durable ${boundary} boundary neither reprobes nor duplicates audit`, async t => {
    const f = await fixture(t, 2);
    let stopped = false;
    f.options.afterSave = async at => {
      if (!stopped && at === boundary && f.calls.length) {
        stopped = true;
        throw new Error(`crash after ${boundary}`);
      }
    };
    await assert.rejects(discoverWithCheckpoint(f.options), /crash after/);
    const rows = await f.options.loadDb();
    rows[0].mbid = 'fresh-after-crash';
    await saveApprovedArtists(f.db, rows);
    await atomicDiscoveryJson(f.options.auditFile, [{ artist: 'External', note: 'preserve' }, ...JSON.parse(await fs.readFile(f.options.auditFile, 'utf-8').catch(() => '[]'))]);
    const beforeWrites = f.writes();
    delete f.options.afterSave;
    await discoverWithCheckpoint(f.options);
    assert.equal(f.calls.length, 2);
    assert.equal((await f.options.loadDb())[0].mbid, 'fresh-after-crash');
    const audit = JSON.parse(await fs.readFile(f.options.auditFile, 'utf-8'));
    assert.equal(audit.length, 3);
    assert.equal(new Set(audit.filter((a: { discoveryOperationId?: string }) => a.discoveryOperationId).map((a: { discoveryOperationId: string }) => a.discoveryOperationId)).size, 2);
    if (boundary === 'db' || boundary === 'audit') assert.equal(f.writes(), beforeWrites, 'already committed DB rows are not saved again');
  });
}

test('partial DB save recovers applied and unapplied rows without losing neighbour fields', async t => {
  const f = await fixture(t, 2);
  const shardedDb = path.join(f.dir, 'sharded-artists');
  await saveApprovedArtists(shardedDb, f.artists.map((a, index) => ({ ...a, name: `${index ? 'B' : 'A'} Band` })));
  f.options.loadDb = () => loadApprovedArtists(shardedDb);
  f.options.saveDb = rows => saveApprovedArtists(shardedDb, rows);
  const actualRename = fsPromises.rename;
  let shardRenames = 0;
  const rename = t.mock.method(fsPromises, 'rename', async (from: string, to: string) => {
    if (to.startsWith(shardedDb + path.sep) && ++shardRenames === 2) throw new Error('partial shard save');
    await actualRename(from, to);
  });
  await assert.rejects(discoverWithCheckpoint(f.options), /partial shard/);
  rename.mock.restore();
  assert.equal((await f.options.loadDb()).filter(a => a.tourUrl).length, 1, 'first real shard committed before second shard rename failed');
  const rows = await f.options.loadDb();
  rows[1].mbid = 'fresh-unapplied-neighbour';
  await saveApprovedArtists(shardedDb, rows);
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.options.loadDb()).filter(a => a.tourUrl).length, 2);
  assert.equal((await f.options.loadDb())[1].mbid, 'fresh-unapplied-neighbour');
  assert.equal(JSON.parse(await fs.readFile(f.options.auditFile, 'utf-8')).length, 2);
});

test('probe resumes saved slice and heals results projection; same input is idempotent', async t => {
  const f = await fixture(t);
  f.options.mode = 'probe';
  f.options.candidates = f.artists.map(a => ({ name: a.name, website: a.website! }));
  let stopped = false;
  f.options.afterSave = async boundary => {
    if (!stopped && boundary === 'checkpoint' && f.calls.length) { stopped = true; throw new Error('projection interrupted'); }
  };
  await assert.rejects(discoverWithCheckpoint(f.options), /projection interrupted/);
  delete f.options.afterSave;
  await discoverWithCheckpoint(f.options);
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 12);
  assert.equal(f.writes(), 0);
  assert.equal(JSON.parse(await fs.readFile(f.options.resultsFile!, 'utf-8')).length, 12);
  f.options.candidates[0].website = 'https://changed.example.org';
  await assert.rejects(discoverWithCheckpoint(f.options), /input mismatch/);
});

test('apply accepts legacy result arrays and recovers DB-before-audit crash idempotently', async t => {
  const f = await fixture(t, 2);
  f.options.mode = 'apply';
  f.options.results = await f.options.probeSlice(f.artists.map(a => ({ name: a.name, website: a.website! })));
  f.calls.length = 0;
  f.options.afterSave = async boundary => { if (boundary === 'db') throw new Error('DB before audit'); };
  await assert.rejects(discoverWithCheckpoint(f.options), /DB before audit/);
  delete f.options.afterSave;
  await discoverWithCheckpoint(f.options);
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes(), 1);
  assert.equal(JSON.parse(await fs.readFile(f.options.auditFile, 'utf-8')).length, 2);
  f.options.results[0].reason = 'changed';
  await assert.rejects(discoverWithCheckpoint(f.options), /input mismatch/);
});

test('incomplete run rejects limit, website, missing/ambiguous identity and corrupt state', async t => {
  const f = await fixture(t, 2);
  f.options.probeSlice = async () => { throw new Error('interrupt'); };
  await assert.rejects(discoverWithCheckpoint(f.options), /interrupt/);
  await assert.rejects(discoverWithCheckpoint({ ...f.options, limit: 1 }), /limit mismatch/);
  const original = await f.options.loadDb();
  const changed = structuredClone(original);
  changed[0].website = 'https://changed.example.org';
  await saveApprovedArtists(f.db, changed);
  await assert.rejects(discoverWithCheckpoint(f.options), /candidate changed/);
  await saveApprovedArtists(f.db, original.slice(1));
  await assert.rejects(discoverWithCheckpoint(f.options), /candidate changed/);
  await saveApprovedArtists(f.db, [...original, { ...original[0], name: original[0].name.toUpperCase() }]);
  await assert.rejects(discoverWithCheckpoint(f.options), /ambiguous/);
  await fs.writeFile(f.options.checkpointFile, '{corrupt');
  await assert.rejects(discoverWithCheckpoint(f.options), /Invalid tour discovery checkpoint/);
});

test('run freezes interrupted candidate selection, skips fresh decisions, next successful call selects additions', async t => {
  const f = await fixture(t, 2);
  const probe = f.options.probeSlice;
  f.options.probeSlice = async () => { throw new Error('interrupt'); };
  await assert.rejects(discoverWithCheckpoint(f.options), /interrupt/);
  const rows = await f.options.loadDb();
  rows[0].tourUrl = 'https://fresh.example.org/live';
  rows[1].tier = 'longtail';
  rows.push({ name: 'New Artist', website: 'https://new.example.org', tier: 'professional' } as ArtistEntry);
  await saveApprovedArtists(f.db, rows);
  f.options.probeSlice = probe;
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 0, 'new decision and no-longer-eligible rows are never reprobed');
  assert.equal((await f.options.loadDb())[0].tourUrl, 'https://fresh.example.org/live');
  await discoverWithCheckpoint({ ...f.options, limit: 1 });
  assert.deepEqual(f.calls, ['New Artist']);
});

test('run preserves legacy no-guess policy for names already ambiguous in initial selection', async t => {
  const f = await fixture(t, 2);
  f.options.limit = 3;
  await saveApprovedArtists(f.db, [...f.artists, { ...f.artists[0], name: f.artists[0].name.toUpperCase() }]);
  await discoverWithCheckpoint(f.options);
  assert.deepEqual(f.calls, ['Artist 01']);
  assert.equal((await f.options.loadDb()).filter(a => a.tourUrl).length, 1);
});

test('persisted eligibility skip remains a no-op after crash and re-eligibility', async t => {
  const f = await fixture(t, 1);
  let initialization = true;
  f.options.afterSave = async boundary => {
    if (boundary !== 'checkpoint') return;
    if (initialization) {
      initialization = false;
      const rows = await f.options.loadDb();
      rows[0].tier = 'longtail';
      await saveApprovedArtists(f.db, rows);
    } else {
      const envelope = JSON.parse(await fs.readFile(f.options.checkpointFile, 'utf-8'));
      if (envelope.state.results.length) throw new Error('crash after persisted skip');
    }
  };
  await assert.rejects(discoverWithCheckpoint(f.options), /persisted skip/);
  const rows = await f.options.loadDb();
  rows[0].tier = 'professional';
  await saveApprovedArtists(f.db, rows);
  delete f.options.afterSave;
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.options.loadDb())[0].tourUrlProbeTriedAt, undefined);
  await discoverWithCheckpoint(f.options);
  assert.equal(f.calls.length, 1);
});

test('checkpoint rejects checksum corruption and unknown schema even with recomputed checksum', async t => {
  const f = await fixture(t, 1);
  f.options.probeSlice = async () => { throw new Error('interrupt'); };
  await assert.rejects(discoverWithCheckpoint(f.options), /interrupt/);
  const original = JSON.parse(await fs.readFile(f.options.checkpointFile, 'utf-8'));
  const corrupt = structuredClone(original);
  corrupt.state.id = 'tampered';
  await atomicDiscoveryJson(f.options.checkpointFile, corrupt);
  await assert.rejects(discoverWithCheckpoint(f.options), /Invalid tour discovery checkpoint/);
  original.state.version = 99;
  original.digest = createHash('sha256').update(JSON.stringify(original.state)).digest('hex');
  await atomicDiscoveryJson(f.options.checkpointFile, original);
  await assert.rejects(discoverWithCheckpoint(f.options), /Invalid tour discovery checkpoint/);
});

test('failed rename preserves prior readable checkpoint and cleans temporary file', async t => {
  const f = await fixture(t, 1);
  await atomicDiscoveryJson(f.options.checkpointFile, { prior: true });
  const rename = t.mock.method(fsPromises, 'rename', async () => { throw new Error('rename failure'); });
  await assert.rejects(atomicDiscoveryJson(f.options.checkpointFile, { changed: true }), /rename failure/);
  rename.mock.restore();
  assert.deepEqual(JSON.parse(await fs.readFile(f.options.checkpointFile, 'utf-8')), { prior: true });
  assert.equal((await fs.readdir(f.dir)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('real CLI probe and apply use durable sidecars and preserve legacy arrays without network', async t => {
  const f = await fixture(t, 1);
  const candidates = path.join(f.dir, 'candidates.json');
  const results = path.join(f.dir, 'cli-results.json');
  const preload = path.join(f.dir, 'offline.cjs');
  // The subprocess refuses all network. Successful legacy input apply uses temp data/artists.
  await fs.writeFile(preload, "global.fetch = async () => { throw new Error('network disabled in fixture'); };\n");
  await atomicDiscoveryJson(candidates, f.artists.map(a => ({ name: a.name, website: a.website })));
  const script = path.resolve('src/scripts/discover_tour_urls.ts');
  const tsx = path.resolve('node_modules/tsx/dist/loader.mjs');
  const cli = async (...args: string[]) => promisify(execFile)(process.execPath, ['--require', preload, '--import', tsx, script, ...args], { cwd: f.dir });
  await cli('probe', candidates, results);
  const probeState = await fs.readFile(results + '.checkpoint.json', 'utf-8');
  await cli('probe', candidates, results);
  assert.equal(await fs.readFile(results + '.checkpoint.json', 'utf-8'), probeState);
  assert.equal(JSON.parse(await fs.readFile(results, 'utf-8')).length, 1);
  const dbDir = path.join(f.dir, 'data', 'artists');
  await saveApprovedArtists(dbDir, f.artists);
  await atomicDiscoveryJson(results, [{ name: f.artists[0].name, website: f.artists[0].website, tourUrl: `${f.artists[0].website}/tour`, pathPattern: '/tour', reason: 'legacy array' }]);
  await cli('apply', results);
  const state = await fs.readFile(results + '.apply-checkpoint.json', 'utf-8');
  await cli('apply', results);
  assert.equal(await fs.readFile(results + '.apply-checkpoint.json', 'utf-8'), state);
  assert.equal((await loadApprovedArtists(dbDir))[0].tourUrl, `${f.artists[0].website}/tour`);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir, 'data', 'tour-url-probe-hits.json'), 'utf-8')).length, 1);
});

test('completed probe slice is retained before the next slice starts', async () => {
  const originalFetch = global.fetch;
  let retained = 0;
  global.fetch = async () => {
    if (retained === 0) throw new Error('offline');
    return { status: 404, url: 'https://example.org' } as Response;
  };
  try {
    await probeBatch([{ name: 'A', website: 'https://a.example.org' }], 1, async (slice) => {
      retained += slice.length;
    });
    assert.equal(retained, 1, 'completed slice must reach durable-save boundary');
  } finally {
    global.fetch = originalFetch;
  }
});
