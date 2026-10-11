import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the actual Actions shell step with a local gh fixture; no GitHub API calls.
async function artistGate(apiExit: number, files: string) {
  const workflow = await readFile('.github/workflows/pr-test.yml', 'utf8');
  const step = workflow.split('      - name: Check whether this PR touches artist data\n')[1]?.split('\n      - name:')[0];
  assert.ok(step, 'artist-data gate must exist');
  const script = step.split('        run: |\n')[1]?.split('\n').map(line => line.replace(/^          /, '')).join('\n')
    .replaceAll('${{ github.repository }}', 'fixture/repository').replaceAll('${{ github.event.pull_request.number }}', '1');
  assert.ok(script, 'artist-data shell step must exist');
  const dir = await mkdtemp(join(tmpdir(), 'healing-pr-gate-'));
  try {
    await writeFile(join(dir, 'files.txt'), files);
    await writeFile(join(dir, 'gh'), `#!/bin/sh\nset -e\ncat "$FIXTURE_FILES"\nexit ${apiExit}\n`);
    await chmod(join(dir, 'gh'), 0o755);
    const output = join(dir, 'output');
    await writeFile(output, '');
    const result = spawnSync('/bin/bash', ['-c', script], {
      env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_OUTPUT: output, FIXTURE_FILES: join(dir, 'files.txt') }, encoding: 'utf8'
    });
    return { status: result.status, output: await readFile(output, 'utf8') };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('PR artist integrity gate fails closed when changed-file API fails', async () => {
  const result = await artistGate(1, '');
  assert.notEqual(result.status, 0, 'an API failure must fail the job, rather than skip integrity');
  assert.equal(result.output, '');
});

test('PR artist integrity gate consumes the complete changed-file list without SIGPIPE', async () => {
  const result = await artistGate(0, 'data/artists/shard-00.json\n' + 'src/other.ts\n'.repeat(20000));
  assert.equal(result.status, 0);
  assert.equal(result.output, 'touched=true\n');
});

test('PRs without artist-data changes still skip the unrelated integrity ratchet', async () => {
  const result = await artistGate(0, 'src/healing/verify.ts\ntests/healing_semantic.test.ts\n');
  assert.equal(result.status, 0);
  assert.equal(result.output, 'touched=false\n');
});
