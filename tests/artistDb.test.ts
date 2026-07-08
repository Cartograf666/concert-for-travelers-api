import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadApprovedArtists, saveApprovedArtists } from '../src/pipeline/artistDb.js';

async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artistdb-test-'));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('artistDb - legacy .json file mode round-trips a plain array', async () => {
  await withTempDir(async (root) => {
    const file = path.join(root, 'approved_artists.json');
    const artists = [{ name: 'Zebra' }, { name: 'Alpha' }];
    await saveApprovedArtists(file, artists);

    const loaded = await loadApprovedArtists(file);
    assert.strictEqual(loaded.length, 2);
    // saveApprovedArtists sorts by name
    assert.deepStrictEqual(loaded.map((a: any) => a.name), ['Alpha', 'Zebra']);

    const stat = await fs.stat(file);
    assert.ok(stat.isFile());
  });
});

test('artistDb - legacy mode returns [] for a missing file (bootstrap)', async () => {
  await withTempDir(async (root) => {
    const file = path.join(root, 'does-not-exist.json');
    const loaded = await loadApprovedArtists(file);
    assert.deepStrictEqual(loaded, []);
  });
});

test('artistDb - legacy mode rethrows a real read error (corrupt JSON), not silently empty', async () => {
  await withTempDir(async (root) => {
    const file = path.join(root, 'corrupt.json');
    await fs.writeFile(file, '{ not valid json', 'utf-8');
    await assert.rejects(() => loadApprovedArtists(file));
  });
});

test('artistDb - sharded directory mode round-trips across multiple shards', async () => {
  await withTempDir(async (root) => {
    const dbDir = path.join(root, 'artists');
    const artists = [
      { name: 'ABBA' }, { name: 'Zebrahead' }, { name: 'Mumiy Troll' },
      { name: 'Björk' }, { name: '2Pac' }, { name: 'The Beatles' }
    ];
    await saveApprovedArtists(dbDir, artists);

    const files = (await fs.readdir(dbDir)).filter((f) => /^shard-\d+\.json$/.test(f));
    assert.ok(files.length > 1, 'expected artists to spread across more than one shard file');

    const loaded = await loadApprovedArtists(dbDir);
    assert.strictEqual(loaded.length, artists.length);
    const names = loaded.map((a: any) => a.name).sort();
    assert.deepStrictEqual(names, artists.map((a) => a.name).sort());
  });
});

test('artistDb - sharded mode returns [] for a not-yet-created directory (bootstrap)', async () => {
  await withTempDir(async (root) => {
    const dbDir = path.join(root, 'artists');
    const loaded = await loadApprovedArtists(dbDir);
    assert.deepStrictEqual(loaded, []);
  });
});

test('artistDb - sharded mode only rewrites shards whose content actually changed', async () => {
  await withTempDir(async (root) => {
    const dbDir = path.join(root, 'artists');
    const artists = [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Zulu' }];
    await saveApprovedArtists(dbDir, artists);

    const files = (await fs.readdir(dbDir)).filter((f) => /^shard-\d+\.json$/.test(f));
    const mtimesBefore = new Map<string, number>();
    for (const f of files) {
      mtimesBefore.set(f, (await fs.stat(path.join(dbDir, f))).mtimeMs);
    }

    // Re-save with the exact same data -> every shard's content is byte-identical,
    // so none of them should be touched (mtime unchanged).
    await new Promise((r) => setTimeout(r, 20)); // ensure a rewrite would be detectable
    await saveApprovedArtists(dbDir, artists);

    for (const f of files) {
      const mtimeAfter = (await fs.stat(path.join(dbDir, f))).mtimeMs;
      assert.strictEqual(mtimeAfter, mtimesBefore.get(f), `${f} should not have been rewritten`);
    }
  });
});

test('artistDb - sharded mode writes a new/changed shard while leaving others untouched', async () => {
  await withTempDir(async (root) => {
    const dbDir = path.join(root, 'artists');
    const artists = [{ name: 'Alpha' }, { name: 'Zulu' }];
    await saveApprovedArtists(dbDir, artists);

    const files = (await fs.readdir(dbDir)).filter((f) => /^shard-\d+\.json$/.test(f));
    const mtimesBefore = new Map<string, number>();
    for (const f of files) {
      mtimesBefore.set(f, (await fs.stat(path.join(dbDir, f))).mtimeMs);
    }

    await new Promise((r) => setTimeout(r, 20));
    // Add one more artist -> only the shard(s) whose bucket actually changed should rewrite.
    await saveApprovedArtists(dbDir, [...artists, { name: 'Alligator' }]);

    const filesAfter = (await fs.readdir(dbDir)).filter((f) => /^shard-\d+\.json$/.test(f));
    let anyChanged = false;
    let anyUnchanged = false;
    for (const f of filesAfter) {
      const mtimeAfter = (await fs.stat(path.join(dbDir, f))).mtimeMs;
      if (mtimesBefore.has(f)) {
        if (mtimeAfter !== mtimesBefore.get(f)) anyChanged = true;
        else anyUnchanged = true;
      }
    }
    assert.ok(anyChanged, 'expected at least one shard to be rewritten');
    assert.ok(anyUnchanged, 'expected at least one shard to be left untouched');

    const loaded = await loadApprovedArtists(dbDir);
    assert.strictEqual(loaded.length, 3);
  });
});

test('artistDb - sharded mode accepts plain string entries, not just objects', async () => {
  await withTempDir(async (root) => {
    const dbDir = path.join(root, 'artists');
    await saveApprovedArtists(dbDir, ['Zebra', 'Alpha']);
    const loaded = await loadApprovedArtists(dbDir);
    assert.deepStrictEqual(loaded.sort(), ['Alpha', 'Zebra']);
  });
});
