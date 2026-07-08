import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadDenylistGuard } from '../src/pipeline/denylist.js';

async function withTempRoot(
  denylistTerms: string[] | null,
  targetLines: string[] | null,
  fn: (root: string) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'denylist-test-'));
  try {
    await fs.mkdir(path.join(root, 'data'), { recursive: true });
    if (denylistTerms !== null) {
      await fs.writeFile(path.join(root, 'data', 'artist_denylist.json'), JSON.stringify({ terms: denylistTerms }), 'utf-8');
    }
    if (targetLines !== null) {
      await fs.writeFile(path.join(root, 'data', 'artist_scrape_targets.txt'), targetLines.join('\n') + '\n', 'utf-8');
    }
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('Denylist guard - flags an exact (normalized) denylisted term', async () => {
  await withTempRoot(['alternative rock', 'jazz'], [], async (root) => {
    const guard = await loadDenylistGuard(root);
    assert.strictEqual(guard.isDenylisted('Alternative Rock'), true);
    assert.strictEqual(guard.isDenylisted('  jazz  '), true);
    // A real band whose name merely contains a genre word is untouched (substring, not exact).
    assert.strictEqual(guard.isDenylisted('Jazz Sabbath'), false);
    assert.strictEqual(guard.isDenylisted('The Cure'), false);
  });
});

test('Denylist guard - a user\'s explicit scrape target always wins over the denylist', async () => {
  await withTempRoot(['rock', 'live'], ['Rock'], async (root) => {
    const guard = await loadDenylistGuard(root);
    assert.strictEqual(guard.isDenylisted('Rock'), false, 'exempted -- present in artist_scrape_targets.txt');
    assert.strictEqual(guard.isDenylisted('Live'), true, 'not exempted -- absent from targets');
  });
});

test('Denylist guard - missing denylist/targets files degrade to a permissive no-op', async () => {
  await withTempRoot(null, null, async (root) => {
    const guard = await loadDenylistGuard(root);
    assert.strictEqual(guard.isDenylisted('Anything'), false);
  });
});
