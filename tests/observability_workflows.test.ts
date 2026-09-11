import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), relative), 'utf-8');
}

test('self-heal validates source identity instead of requiring publication success', async () => {
  const workflow = await read('.github/workflows/self-heal.yml');
  assert.doesNotMatch(workflow, /workflow_run\.conclusion\s*==\s*'success'/);
  assert.match(workflow, /EXPECTED_SOURCE_RUN_ID:/);
  assert.match(workflow, /EXPECTED_SOURCE_RUN_ATTEMPT:/);
  assert.match(workflow, /npm run heal -- --cohort "\$COHORT"/);
});

test('status-only Pages publishing overlays health on the last-good API', async () => {
  const workflow = await read('.github/workflows/daily-scrape.yml');
  assert.match(workflow, /Restore last-good Pages payload/);
  assert.match(workflow, /cp -R reports\/last-good-site\/\. pages-dist\//);
  assert.match(workflow, /cp dist\/status\.json pages-dist\/status\.json/);
  assert.match(workflow, /needs\.scrape\.outputs\.pages_ready == 'true'/);
});

test('dashboard aggregate includes artist freshness/failures and publication blocking', async () => {
  const dashboard = await read('public/dashboard.html');
  assert.match(dashboard, /gateState === 'blocked'/);
  assert.match(dashboard, /artistReportStale/);
  assert.match(dashboard, /artistFailed > \(\(artistHealth && artistHealth\.total\) \|\| 1\) \* 0\.25/);
});
