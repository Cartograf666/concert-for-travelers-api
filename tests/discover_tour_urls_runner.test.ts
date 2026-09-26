import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverWithCheckpoint, atomicDiscoveryJson, type DiscoveryOptions } from '../src/scripts/tourUrlDiscoveryCheckpoint.js';
import { restoreRunnerCheckpoint, exportRunnerCheckpoint, type RunnerOptions } from '../src/scripts/tourUrlDiscoveryRunner.js';
import { loadApprovedArtists, saveApprovedArtists } from '../src/pipeline/artistDb.js';
import { selectProbeQueue, isTourUrlProbeCandidate } from '../src/scripts/discover_tour_urls.js';
import { reapplyArtistDbDelta } from '../src/scripts/reapply_artist_db_delta.js';
import type { ArtistEntry } from '../src/schemas/artist.js';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function sandbox(t: test.TestContext, count = 12) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'mock-git');
  await fs.mkdir(remote);
  const rows = Array.from({ length: count }, (_, i) => ({ name: `Artist ${String(i).padStart(2, '0')}`, website: `https://artist${i}.example.org`, tier: 'professional' } as ArtistEntry));

  async function runtime(name: string, initialize = false) {
    const dir = path.join(root, name);
    await fs.mkdir(dir);
    const db = path.join(dir, 'artists.json');
    const auditFile = path.join(dir, 'audit.json');
    if (initialize) {
      await saveApprovedArtists(db, rows);
      await atomicDiscoveryJson(auditFile, []);
    }
    const calls: string[] = [];
    let writes = 0;
    const runner: RunnerOptions = {
      checkpointFile: path.join(dir, 'local-checkpoint.json'),
      bundleFile: path.join(dir, 'state', 'checkpoint.json'),
      auditFile, limit: count, loadDb: () => loadApprovedArtists(db),
    };
    const discovery: DiscoveryOptions = {
      ...runner, mode: 'run',
      select: selectProbeQueue, eligible: isTourUrlProbeCandidate,
      saveDb: async artists => { writes++; await saveApprovedArtists(db, artists); },
      probeSlice: async candidates => candidates.map(candidate => {
        calls.push(candidate.name);
        return { ...candidate, tourUrl: `${candidate.website}/tour`, pathPattern: '/tour', reason: 'fixture' };
      }),
    };
    return { dir, db, runner, discovery, calls, writes: () => writes };
  }

  // Mock a Git object tree plus one atomic ref update. Copying files does not
  // become durable until the ref points at their complete immutable snapshot.
  async function push(source: Awaited<ReturnType<typeof runtime>>, interrupted = false) {
    const id = randomUUID();
    const object = path.join(remote, id);
    await fs.mkdir(object);
    await fs.copyFile(source.db, path.join(object, 'artists.json'));
    if (interrupted) throw new Error('export transport interrupted before ref update');
    await fs.copyFile(source.runner.auditFile, path.join(object, 'audit.json'));
    await fs.copyFile(source.runner.bundleFile, path.join(object, 'checkpoint.json'));
    await atomicDiscoveryJson(path.join(remote, 'ref.json'), { id });
  }
  async function checkout(target: Awaited<ReturnType<typeof runtime>>) {
    const { id } = JSON.parse(await fs.readFile(path.join(remote, 'ref.json'), 'utf8'));
    const object = path.join(remote, id);
    await fs.copyFile(path.join(object, 'artists.json'), target.db);
    await fs.copyFile(path.join(object, 'audit.json'), target.runner.auditFile);
    await fs.mkdir(path.dirname(target.runner.bundleFile), { recursive: true });
    await fs.copyFile(path.join(object, 'checkpoint.json'), target.runner.bundleFile);
  }
  return { root, remote, runtime, push, checkout };
}

test('two discarded checkouts resume only pending probes and preserve fresh adjacent fields', async t => {
  const s = await sandbox(t);
  const first = await s.runtime('first', true);
  assert.equal(await restoreRunnerCheckpoint(first.runner), false);
  const probe = first.discovery.probeSlice;
  first.discovery.probeSlice = candidates => {
    if (first.calls.length) throw new Error('ordinary probe failure after saved slice');
    return probe(candidates);
  };
  await assert.rejects(discoverWithCheckpoint(first.discovery), /ordinary probe failure/);
  const firstCalls = [...first.calls];
  assert.equal(await exportRunnerCheckpoint(first.runner), true);
  await s.push(first);
  await fs.rm(first.dir, { recursive: true }); // explicitly disposable runtime only
  const second = await s.runtime('second');
  await s.checkout(second);
  const rows = await second.runner.loadDb();
  rows[0].mbid = 'fresh-field-after-durable-export';
  await saveApprovedArtists(second.db, rows);
  await restoreRunnerCheckpoint(second.runner);
  await discoverWithCheckpoint(second.discovery);
  assert.equal(firstCalls.length, 10);
  assert.equal(second.calls.length, 2);
  assert.equal(new Set([...firstCalls, ...second.calls]).size, 12);
  assert.equal((await second.runner.loadDb())[0].mbid, 'fresh-field-after-durable-export');
  const audit = JSON.parse(await fs.readFile(second.runner.auditFile, 'utf8'));
  assert.equal(audit.length, 12);
  assert.equal(new Set(audit.map((record: { discoveryOperationId: string }) => record.discoveryOperationId)).size, 12);
  assert.equal(second.writes(), 1, 'completed durable slice is not applied again');
});

test('DB-before-audit interruption retains pending intents across fresh checkout', async t => {
  const s = await sandbox(t, 2);
  const first = await s.runtime('first', true);
  first.discovery.afterSave = async boundary => { if (boundary === 'db') throw new Error('DB-before-audit interruption'); };
  await assert.rejects(discoverWithCheckpoint(first.discovery), /DB-before-audit/);
  await exportRunnerCheckpoint(first.runner);
  await s.push(first);
  await fs.rm(first.dir, { recursive: true });
  const second = await s.runtime('second');
  await s.checkout(second);
  await restoreRunnerCheckpoint(second.runner);
  await discoverWithCheckpoint(second.discovery);
  assert.equal(second.calls.length, 0);
  assert.equal(second.writes(), 0);
  assert.equal(JSON.parse(await fs.readFile(second.runner.auditFile, 'utf8')).length, 2);
  await exportRunnerCheckpoint(second.runner);
  await s.push(second);
  const third = await s.runtime('third');
  await s.checkout(third);
  third.runner.limit = 3; // completed snapshot may start a different-size batch
  await restoreRunnerCheckpoint(third.runner);
  await discoverWithCheckpoint({ ...third.discovery, limit: 3 });
  assert.equal(third.calls.length, 0);
  assert.equal(JSON.parse(await fs.readFile(third.runner.auditFile, 'utf8')).length, 2);
});

test('unconfirmed export leaves prior remote checkpoint intact', async t => {
  const s = await sandbox(t);
  const first = await s.runtime('first', true);
  const probe = first.discovery.probeSlice;
  first.discovery.probeSlice = candidates => {
    if (first.calls.length) throw new Error('slice interrupted');
    return probe(candidates);
  };
  await assert.rejects(discoverWithCheckpoint(first.discovery), /slice interrupted/);
  await exportRunnerCheckpoint(first.runner);
  await s.push(first);
  const confirmed = await fs.readFile(path.join(s.remote, 'ref.json'), 'utf8');
  first.discovery.probeSlice = probe;
  await discoverWithCheckpoint(first.discovery);
  await exportRunnerCheckpoint(first.runner);
  await assert.rejects(s.push(first, true), /transport interrupted/);
  assert.equal(await fs.readFile(path.join(s.remote, 'ref.json'), 'utf8'), confirmed);
  await fs.rm(first.dir, { recursive: true });
  const second = await s.runtime('second');
  await s.checkout(second);
  await restoreRunnerCheckpoint(second.runner);
  await discoverWithCheckpoint(second.discovery);
  assert.equal(second.calls.length, 2, 'only unconfirmed in-flight work repeats');
});

test('invalid bundle, changed limit/input/version fail before replacing local state', async t => {
  const s = await sandbox(t);
  const first = await s.runtime('first', true);
  first.discovery.afterSave = async boundary => { if (boundary === 'db') throw new Error('stop'); };
  await assert.rejects(discoverWithCheckpoint(first.discovery), /stop/);
  await exportRunnerCheckpoint(first.runner);
  await s.push(first);
  const second = await s.runtime('second');
  await s.checkout(second);
  const original = await fs.readFile(second.runner.bundleFile, 'utf8');
  await atomicDiscoveryJson(second.runner.checkpointFile, { sentinel: 'preserve on failed restore' });
  const sentinel = await fs.readFile(second.runner.checkpointFile, 'utf8');
  await assert.rejects(restoreRunnerCheckpoint({ ...second.runner, limit: 99 }), /limit mismatch/);
  const rows = await second.runner.loadDb();
  rows[0].website = 'https://changed.example.org';
  await saveApprovedArtists(second.db, rows);
  await assert.rejects(restoreRunnerCheckpoint(second.runner), /candidate changed/);
  rows[0].website = 'https://artist0.example.org';
  await saveApprovedArtists(second.db, rows);
  const changed = JSON.parse(original);
  changed.payload.version = 99;
  changed.digest = hash(changed.payload);
  await atomicDiscoveryJson(second.runner.bundleFile, changed);
  await assert.rejects(restoreRunnerCheckpoint(second.runner), /bundle\/version/);
  changed.payload.version = 1;
  changed.payload.journal.state.inputHash = 'changed';
  changed.payload.journal.digest = hash(changed.payload.journal.state);
  changed.digest = hash(changed.payload);
  await atomicDiscoveryJson(second.runner.bundleFile, changed);
  await assert.rejects(restoreRunnerCheckpoint(second.runner), /Invalid tour discovery/);
  // Atomic local export preserves its previous file when rename cannot succeed.
  await fs.rm(second.runner.bundleFile);
  await fs.mkdir(second.runner.bundleFile);
  await assert.rejects(exportRunnerCheckpoint({ ...first.runner, bundleFile: second.runner.bundleFile }), /EISDIR|ENOTEMPTY/);
  await fs.rm(second.runner.bundleFile, { recursive: true });
  await fs.writeFile(second.runner.bundleFile, original.slice(0, 25));
  await assert.rejects(restoreRunnerCheckpoint(second.runner), /JSON|Unexpected|Unterminated/);
  assert.equal(await fs.readFile(second.runner.checkpointFile, 'utf8'), sentinel);
  assert.equal(second.calls.length, 0);
});

for (const complete of [false, true]) {
  test(`delta-skipped row blocks ${complete ? 'completed' : 'incomplete'} runner state without erasing neighbour`, async t => {
    const s = await sandbox(t, complete ? 2 : 12);
    const first = await s.runtime('first', true);
    const before = path.join(s.root, 'before.json');
    await fs.copyFile(first.db, before);
    if (!complete) {
      const probe = first.discovery.probeSlice;
      first.discovery.probeSlice = candidates => {
        if (first.calls.length) throw new Error('stop');
        return probe(candidates);
      };
      await assert.rejects(discoverWithCheckpoint(first.discovery), /stop/);
    } else await discoverWithCheckpoint(first.discovery);
    await exportRunnerCheckpoint(first.runner);
    await s.push(first);
    const second = await s.runtime('second');
    await s.checkout(second);
    // The existing composite resets to a newer DB, then its row-level delta
    // deliberately skips an artist with a concurrent adjacent-field change.
    await fs.copyFile(before, second.db);
    const rows = await second.runner.loadDb();
    rows[0].mbid = 'concurrent-neighbour-preserved';
    await saveApprovedArtists(second.db, rows);
    const delta = await reapplyArtistDbDelta(before, first.db, second.db);
    assert.equal(delta.skippedConflicts, 1);
    await assert.rejects(restoreRunnerCheckpoint(second.runner), /applied DB outcome missing/);
    assert.equal((await second.runner.loadDb())[0].mbid, 'concurrent-neighbour-preserved');
    assert.equal((await second.runner.loadDb())[0].tourUrl, undefined);
    assert.equal(second.calls.length, 0);
    await assert.rejects(fs.access(second.runner.checkpointFile), /ENOENT/);
  });
}

test('workflow guards finalizer and commits journal alongside DB/audit from latest main', async () => {
  const workflow = await fs.readFile('.github/workflows/discover-tour-urls.yml', 'utf8');
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /group: artist-db-write\n  queue: max[^\n]*\n  cancel-in-progress: false/);
  assert.match(workflow, /if: \$\{\{ always\(\) && steps\.prepare\.outcome == 'success' \}\}/);
  assert.match(workflow, /if: \$\{\{ always\(\) && steps\.prepare\.outcome == 'success' && steps\.export\.outcome == 'success' \}\}/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/commit-artist-db-delta/);
  assert.match(workflow, /extra-path: data\/tour-url-discovery-state/);
  assert.match(workflow, /extra-after-dir: \/tmp\/tour-url-discovery-state-after/);
  assert.match(workflow, /default: '300'/);
  assert.match(workflow, /COUNT=\$\{ARTISTS_COUNT_INPUT:-800\}/);
  assert.match(workflow, /cron: '0 4 \* \* \*'/);
});

test('workflow adapter CLI restores and exports the canonical journal without network', async t => {
  const s = await sandbox(t, 0);
  const runtime = await s.runtime('cli', true);
  await saveApprovedArtists(path.join(runtime.dir, 'data', 'artists'), []);
  await atomicDiscoveryJson(path.join(runtime.dir, 'data', 'tour-url-probe-hits.json'), []);
  const invoke = promisify(execFile);
  const tsx = path.resolve('node_modules/tsx/dist/loader.mjs');
  const adapter = path.resolve('src/scripts/tourUrlDiscoveryRunner.ts');
  const discovery = path.resolve('src/scripts/discover_tour_urls.ts');
  const run = (script: string, ...args: string[]) => invoke(process.execPath, ['--import', tsx, script, ...args], { cwd: runtime.dir });
  await run(adapter, 'restore', '0');
  await run(discovery, 'run', '0');
  const canonical = path.join(runtime.dir, 'data', 'tour-url-discovery.checkpoint.json');
  const prior = await fs.readFile(canonical, 'utf8');
  await run(adapter, 'export', '0');
  await fs.unlink(canonical);
  await run(adapter, 'restore', '1'); // completed batch permits a new limit
  assert.equal(await fs.readFile(canonical, 'utf8'), prior);
});
