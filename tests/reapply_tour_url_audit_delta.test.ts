import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { reapplyTourUrlAuditDelta } from '../src/scripts/reapply_tour_url_audit_delta.js';

test('reapplyTourUrlAuditDelta preserves entries appended by a conflicted run', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tour-audit-delta-'));
  const before = path.join(dir, 'before.json');
  const after = path.join(dir, 'after.json');
  const current = path.join(dir, 'current.json');
  const baseline = [{ artist: 'Existing', appliedAt: '1' }];
  const localHit = { artist: 'Local hit', appliedAt: '2' };
  const remoteHit = { artist: 'Remote hit', appliedAt: '3' };
  await Promise.all([
    fs.writeFile(before, JSON.stringify(baseline)),
    fs.writeFile(after, JSON.stringify([...baseline, localHit])),
    fs.writeFile(current, JSON.stringify([...baseline, remoteHit]))
  ]);

  assert.deepStrictEqual(await reapplyTourUrlAuditDelta(before, after, current), { added: 1, alreadyPresent: 0 });
  assert.deepStrictEqual(JSON.parse(await fs.readFile(current, 'utf-8')), [...baseline, remoteHit, localHit]);
  await fs.rm(dir, { recursive: true, force: true });
});
