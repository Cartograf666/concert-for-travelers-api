import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

interface ConcurrencyDropEvent {
  workflow: string;
  runId: number;
  at: string;
}

const WORKFLOW_FILES = [
  'daily-scrape.yml',
  'enrich-auto.yml',
  'enrich-database.yml',
  'enrich-metadata.yml',
  'enrich-similar.yml',
  'data-hygiene.yml'
];

const CONCURRENCY_DROPS_FILE = path.join(process.cwd(), 'data', 'concurrency-drops.json');
const THRESHOLD = 3;
const TITLE = '🚨 Concurrency-starvation alerts (watchdog)';

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err: any) {
    console.warn(`[ConcurrencyWatchdog] Command failed: ${cmd} - ${err.message}`);
    return '';
  }
}

async function main() {
  let data: { events: ConcurrencyDropEvent[] } = { events: [] };
  try {
    const content = await fs.readFile(CONCURRENCY_DROPS_FILE, 'utf-8');
    data = JSON.parse(content);
    if (!Array.isArray(data.events)) {
      data.events = [];
    }
  } catch {
    // start fresh if missing or malformed
  }

  const existingIds = new Set(data.events.map(e => e.runId));
  let newDropsFound = 0;

  for (const file of WORKFLOW_FILES) {
    console.log(`[ConcurrencyWatchdog] Fetching recent runs for ${file}...`);
    const stdout = runCommand(`gh run list --workflow "${file}" --limit 50 --json databaseId,conclusion,createdAt,url,workflowName`);
    if (!stdout) {
      continue;
    }

    let runs: Array<{ databaseId: number; conclusion: string; createdAt: string; url: string; workflowName: string }> = [];
    try {
      runs = JSON.parse(stdout);
    } catch (err: any) {
      console.warn(`[ConcurrencyWatchdog] Failed to parse JSON for ${file}: ${err.message}`);
      continue;
    }

    const cancelledRuns = runs.filter(r => r.conclusion === 'cancelled');
    for (const run of cancelledRuns) {
      if (existingIds.has(run.databaseId)) {
        continue;
      }

      console.log(`[ConcurrencyWatchdog] Checking annotations for run ${run.databaseId}...`);
      const viewStdout = runCommand(`gh run view ${run.databaseId}`);
      if (viewStdout.includes('Canceling since a higher priority waiting request for artist-db-write exists')) {
        console.log(`[ConcurrencyWatchdog] Found concurrency-preemption for run ${run.databaseId} (${run.workflowName})`);
        data.events.push({
          workflow: run.workflowName,
          runId: run.databaseId,
          at: run.createdAt
        });
        existingIds.add(run.databaseId);
        newDropsFound++;
      }
    }
  }

  // 30-day cutoff filter
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  data.events = data.events.filter(e => new Date(e.at).getTime() > cutoffMs);

  // Sort events by date ascending
  data.events.sort((a, b) => a.at.localeCompare(b.at));

  // Write changes
  await fs.mkdir(path.dirname(CONCURRENCY_DROPS_FILE), { recursive: true });
  await fs.writeFile(CONCURRENCY_DROPS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[ConcurrencyWatchdog] Done checking. New drops: ${newDropsFound}. Total drops in last 30 days: ${data.events.length}`);

  // Manage GitHub Issue
  const repo = process.env.REPO || '';
  const repoFlag = repo ? `--repo "${repo}"` : '';

  // Check if there is an open issue
  const issueListStdout = runCommand(`gh issue list ${repoFlag} --state open --search "${TITLE} in:title" --json number --jq ".[0].number // empty"`);
  const openIssueNumber = issueListStdout ? parseInt(issueListStdout, 10) : null;

  if (data.events.length > THRESHOLD) {
    const listBody = data.events.map(e => `- **${e.workflow}**: Run ID [${e.runId}](https://github.com/${repo || 'Cartograf666/concert-for-travelers-api'}/actions/runs/${e.runId}) at ${e.at}`).join('\n');
    const issueBody = `The concurrency watchdog detected ${data.events.length} queue preemption drops in the last 30 days (threshold: ${THRESHOLD}).\n\n### Concurrency preemption events:\n${listBody}`;

    if (openIssueNumber) {
      console.log(`[ConcurrencyWatchdog] Updating open issue #${openIssueNumber}...`);
      runCommand(`gh issue comment ${repoFlag} "${openIssueNumber}" --body "Concurrency watchdog update on ${new Date().toISOString()}: detected ${data.events.length} preemption drops in the last 30 days."`);
    } else {
      console.log(`[ConcurrencyWatchdog] Creating a new issue...`);
      runCommand(`gh issue create ${repoFlag} --title "${TITLE}" --body "${issueBody}"`);
    }
  } else {
    if (openIssueNumber) {
      console.log(`[ConcurrencyWatchdog] Concurrency starvation resolved. Closing issue #${openIssueNumber}...`);
      runCommand(`gh issue close ${repoFlag} "${openIssueNumber}" --comment "Resolved: Concurrency starvation drops in the last 30 days (${data.events.length}) is below the threshold of ${THRESHOLD}."`);
    } else {
      console.log(`[ConcurrencyWatchdog] Concurrency starvation is healthy (${data.events.length} drops).`);
    }
  }
}

void main().catch(err => {
  console.error(`[ConcurrencyWatchdog] Fatal error: ${err.message}`);
  process.exit(1);
});
