import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { WORKFLOW_FILES } from '../src/scripts/check_concurrency_drops.js';

/**
 * The concurrency watchdog reports work dropped when a run in the
 * `artist-db-write` group is cancelled. It only sees the workflows it is told
 * about, so a new writer added to the group without being added to the list is
 * silently unwatched -- which is exactly what had happened to three of them.
 */
test('the watchdog list covers every workflow in the artist-db-write group', () => {
  const dir = path.join(process.cwd(), '.github', 'workflows');
  const inGroup = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .filter((f) => /concurrency:\s*\n\s*group:\s*artist-db-write/.test(fs.readFileSync(path.join(dir, f), 'utf-8')))
    .sort();

  assert.ok(inGroup.length > 0, 'sanity: the group must have members');
  assert.deepEqual(
    [...WORKFLOW_FILES].sort(),
    inGroup,
    'a workflow joined or left concurrency group artist-db-write without updating WORKFLOW_FILES in check_concurrency_drops.ts'
  );
});

test('every listed workflow file actually exists', () => {
  for (const f of WORKFLOW_FILES) {
    assert.ok(
      fs.existsSync(path.join(process.cwd(), '.github', 'workflows', f)),
      `${f} is listed but missing -- the watchdog would query a workflow that cannot run`
    );
  }
});
