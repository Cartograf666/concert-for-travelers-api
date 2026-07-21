import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { saveApprovedArtists, loadApprovedArtists } from '../src/pipeline/artistDb.js';
import { reapplyArtistDbDelta } from '../src/scripts/reapply_artist_db_delta.js';

test('reapplyArtistDbDelta replays changed, added, and removed rows onto a fresh DB', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artist-delta-test-'));
  try {
    const before = path.join(root, 'before');
    const after = path.join(root, 'after');
    const current = path.join(root, 'current');

    await saveApprovedArtists(before, [
      { name: 'Changed', popularity: { listeners: 1, playcount: 2 } },
      { name: 'Removed' },
      { name: 'Untouched' }
    ]);
    await saveApprovedArtists(after, [
      { name: 'Changed', popularity: { listeners: 99, playcount: 200 } },
      { name: 'Added' },
      { name: 'Untouched' }
    ]);
    await saveApprovedArtists(current, [
      { name: 'Changed', website: 'https://fresh.example' },
      { name: 'Removed' },
      { name: 'Untouched', website: 'https://keep.example' },
      { name: 'Concurrent Fresh Row' }
    ]);

    const stats = await reapplyArtistDbDelta(before, after, current);
    const rows = await loadApprovedArtists(current);
    const byName = new Map(rows.map((row: any) => [row.name, row]));

    assert.deepStrictEqual(stats, { changedOrAdded: 1, removed: 1, skippedConflicts: 1, finalCount: 4 });
    assert.strictEqual(byName.get('Changed').website, 'https://fresh.example');
    assert.strictEqual(byName.get('Changed').popularity, undefined);
    assert.strictEqual(byName.has('Added'), true);
    assert.strictEqual(byName.has('Removed'), false);
    assert.strictEqual(byName.get('Untouched').website, 'https://keep.example');
    assert.strictEqual(byName.has('Concurrent Fresh Row'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reapplyArtistDbDelta does not delete rows that changed concurrently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artist-delta-remove-test-'));
  try {
    const before = path.join(root, 'before');
    const after = path.join(root, 'after');
    const current = path.join(root, 'current');

    await saveApprovedArtists(before, [{ name: 'Removed', website: 'https://old.example' }]);
    await saveApprovedArtists(after, []);
    await saveApprovedArtists(current, [{ name: 'Removed', website: 'https://fresh.example' }]);

    const stats = await reapplyArtistDbDelta(before, after, current);
    const rows = await loadApprovedArtists(current);

    assert.deepStrictEqual(stats, { changedOrAdded: 0, removed: 0, skippedConflicts: 1, finalCount: 1 });
    assert.strictEqual((rows[0] as any).website, 'https://fresh.example');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
