import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadArtistTargets } from '../src/run-artists.js';
import { saveApprovedArtists } from '../src/pipeline/artistDb.js';

test('run-artists - active sweep targets union professional tier with explicit manual targets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-artists-test-'));
  try {
    const targetFile = path.join(root, 'artist_scrape_targets.txt');
    const artistDb = path.join(root, 'artists');
    await fs.writeFile(targetFile, 'Manual Artist\nProfessional Artist\n', 'utf-8');
    await saveApprovedArtists(artistDb, [
      { name: 'Professional Artist', tier: 'professional' },
      { name: 'Another Pro', tier: 'professional' },
      { name: 'Long Tail', tier: 'longtail' }
    ]);

    const targets = await loadArtistTargets(targetFile, artistDb);
    assert.deepStrictEqual(targets.sort(), ['Another Pro', 'Manual Artist', 'Professional Artist'].sort());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('run-artists - untiered (not yet scored) artists are included, only longtail is excluded', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-artists-untiered-test-'));
  try {
    const targetFile = path.join(root, 'artist_scrape_targets.txt');
    const artistDb = path.join(root, 'artists');
    await fs.writeFile(targetFile, '', 'utf-8');
    await saveApprovedArtists(artistDb, [
      { name: 'Professional Artist', tier: 'professional' },
      { name: 'Legacy Untiered' }, // no tier field at all -- not yet scored
      { name: 'Long Tail', tier: 'longtail' }
    ]);

    const targets = await loadArtistTargets(targetFile, artistDb);
    assert.deepStrictEqual(targets.sort(), ['Legacy Untiered', 'Professional Artist'].sort());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('run-artists - case/whitespace-variant names collapse to one target', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-artists-dedup-test-'));
  try {
    const targetFile = path.join(root, 'artist_scrape_targets.txt');
    const artistDb = path.join(root, 'artists');
    await fs.writeFile(targetFile, ' muse \nMUSE\n', 'utf-8');
    await saveApprovedArtists(artistDb, [{ name: 'Muse', tier: 'professional' }]);

    const targets = await loadArtistTargets(targetFile, artistDb);
    assert.strictEqual(targets.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
