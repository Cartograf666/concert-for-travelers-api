import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import vm from 'node:vm';

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

test('health gate records a consistent eligible or blocked state without claiming deployment', async () => {
  const workflow = await read('.github/workflows/daily-scrape.yml');
  const block = workflow.slice(workflow.indexOf('id: health-check')).split('script: |')[1].split('\n      - name:')[0];
  const script = block.split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
  for (const [ok, expected] of [[8, 'eligible'], [1, 'blocked']] as const) {
    const files = new Map([
      ['dist/index.json', JSON.stringify({ stats: { totalConcerts: 100 } })],
      ['dist/status.json', JSON.stringify({ scrapersTotal: 10, scrapersOk: ok, publication: { state: 'pending_health_gate' } })]
    ]);
    const outputs: Record<string, string> = {};
    const failures: string[] = [];
    const context = vm.createContext({
      require: () => ({ existsSync: (name: string) => files.has(name), readFileSync: (name: string) => files.get(name),
        writeFileSync: (name: string, body: string) => files.set(name, body), mkdirSync: () => {} }),
      core: { setOutput: (name: string, value: string) => { outputs[name] = value; }, setFailed: (message: string) => failures.push(message), warning: () => {} },
      console: { log: () => {} }
    });
    vm.runInContext(`(() => { ${script} })()`, context);
    const result = JSON.parse(files.get('dist/status.json')!);
    assert.equal(result.publication.state, expected);
    assert.equal(result.publication.healthGate.state, expected);
    assert.equal(outputs.should_deploy, expected === 'eligible' ? 'true' : 'false');
    assert.equal(failures.length, expected === 'blocked' ? 1 : 0);
    assert.notEqual(result.publication.state, 'published');
  }
});

test('artist source diagnostics travel with the manifest in producer and consumer caches', async () => {
  for (const file of ['artist-scrape.yml', 'daily-scrape.yml']) {
    const workflow = await read(`.github/workflows/${file}`);
    assert.match(workflow, /reports\/artist-run-manifest\.json\n\s+reports\/artist-source-health\.json/);
  }
});
