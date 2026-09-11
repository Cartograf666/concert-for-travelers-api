/**
 * Post-merge confirmation for automated repairs.
 *
 * heal.ts proves a repair works at the moment it is made (live fetch + plausibility
 * checks). This closes the loop on the runs after: the next complete manifest must
 * explicitly report the repaired path/hash as successful or failed, and
 * after REVERT_AFTER_FAILURES consecutive post-repair failures the previous config
 * is restored byte-for-byte. The rolled-back strategy is then recorded as known-bad
 * for that scraper, so the next healing run reaches for a different one instead of
 * re-applying the same broken fix every day.
 *
 * Runs inside prune-dead-scrapers.yml: that workflow already downloads the daily
 * fail-log, holds the artist-db-write lock, and commits to main.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  loadRepairHistory, saveRepairHistory, RepairRecord, REVERT_AFTER_FAILURES,
  ScraperCohort, cohortForConfigPath
} from '../healing/history.js';
import { failureLogMatchesManifest, readRunManifest, ScrapeRunManifest } from '../observability/run_manifest.js';

export interface ConfirmResult {
  confirmed: string[];
  reverted: string[];
  stillPending: string[];
}

export interface ConfirmOptions {
  /** A complete run is only evidence about its own scrape cohort. */
  cohort?: ScraperCohort;
  run?: Pick<ScrapeRunManifest, 'generatedAt' | 'complete' | 'run' | 'outcomes'>;
  /** Migration safeguard: report a rollback without writing/deleting a config. */
  dryRun?: boolean;
}

function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function configPathForRecord(scrapersDir: string, record: RepairRecord): string | null {
  const relative = record.configPath?.replace(/\\/g, '/').replace(/^\.\//, '');
  const expected = record.cohort === 'artist'
    ? `scrapers/artists/${record.id}.json`
    : record.cohort === 'venue' ? `scrapers/${record.id}.json` : undefined;
  if (!relative || relative !== expected || cohortForConfigPath(relative) !== record.cohort) return null;
  const repoRoot = path.dirname(scrapersDir);
  const absolute = path.resolve(repoRoot, relative);
  return absolute.startsWith(`${path.resolve(scrapersDir)}${path.sep}`) ? absolute : null;
}

export async function confirmRepairs(
  records: RepairRecord[],
  _failingIds: Set<string>,
  scrapersDir: string,
  now: string,
  options: ConfirmOptions = {}
): Promise<ConfirmResult> {
  const result: ConfirmResult = { confirmed: [], reverted: [], stillPending: [] };

  for (const record of records) {
    if (record.status !== 'pending') continue;
    // A log from the other scheduled scrape must never confirm/reset this
    // repair. Legacy records lack a cohort, so production leaves them pending
    // for manual migration instead of guessing.
    if (options.cohort && record.cohort !== options.cohort) continue;

    // A complete manifest is necessary but not sufficient: the run must contain
    // an explicit outcome for the exact config path and exact bytes written by
    // the healer. Absence can mean deleted/skipped/not-loaded, never success.
    const runAt = options.run ? Date.parse(options.run.generatedAt) : NaN;
    const repairedAt = Date.parse(record.repairedAt);
    if (!options.run?.complete || !Number.isFinite(runAt) || !Number.isFinite(repairedAt) || runAt <= repairedAt) {
      result.stillPending.push(record.id);
      continue;
    }

    const runKey = `${options.run.run.id}:${options.run.run.attempt}`;
    const lastRun = record.lastProcessedRun;
    const lastRunAt = lastRun ? Date.parse(lastRun.generatedAt) : NaN;
    if (lastRun && (`${lastRun.id}:${lastRun.attempt}` === runKey ||
        (Number.isFinite(lastRunAt) && runAt <= lastRunAt))) {
      result.stillPending.push(record.id);
      continue;
    }

    const outcome = options.run.outcomes.find((candidate) =>
      candidate.id === record.id &&
      candidate.configPath === record.configPath &&
      candidate.configHash === record.repairedConfigHash
    );
    if (!outcome) {
      result.stillPending.push(record.id);
      continue;
    }

    if (options.dryRun) {
      result.stillPending.push(record.id);
      console.log(`[ConfirmRepairs] ${record.id}: would process ${outcome.status} outcome from ${runKey} (dry run).`);
      continue;
    }

    record.lastProcessedRun = { ...options.run.run, generatedAt: options.run.generatedAt };
    if (outcome.status === 'succeeded') {
      record.status = 'confirmed';
      result.confirmed.push(record.id);
      continue;
    }

    record.failuresSinceRepair += 1;
    if (record.failuresSinceRepair < REVERT_AFTER_FAILURES) {
      result.stillPending.push(record.id);
      continue;
    }

    const configPath = options.cohort ? configPathForRecord(scrapersDir, record) : path.join(scrapersDir, `${record.id}.json`);
    if (!configPath) {
      console.warn(`[ConfirmRepairs] ${record.id}: missing or invalid recorded config path; leaving repair pending.`);
      result.stillPending.push(record.id);
      continue;
    }
    try {
      const current = await fs.readFile(configPath, 'utf-8');
      if (options.cohort && (!record.repairedConfigHash || sha256(current) !== record.repairedConfigHash)) {
        record.status = 'superseded';
        result.reverted.push(record.id);
        console.warn(`[ConfirmRepairs] ${record.id}: config changed after repair; refusing to overwrite it.`);
        continue;
      }
    } catch {
      // prune-dead-scrapers retired the scraper in the meantime. Restoring the old
      // config here would resurrect a config that was deliberately deleted, so only
      // the history entry is updated.
      console.warn(`[ConfirmRepairs] ${record.id}: config no longer exists, recording the rollback without restoring it.`);
      if (!options.cohort) {
        // Backwards-compatible API behavior for callers/tests that have no
        // cohort evidence. The production CLI always supplies a cohort and
        // deliberately leaves such a legacy record untouched during migration.
        record.status = 'reverted';
        record.revertedAt = now;
        result.reverted.push(record.id);
      } else {
        record.status = 'superseded';
        result.reverted.push(record.id);
      }
      continue;
    }

    try {
      await fs.writeFile(configPath, JSON.stringify(record.previousConfig, null, 2) + '\n', 'utf-8');
      record.status = 'reverted';
      record.revertedAt = now;
      result.reverted.push(record.id);
      console.log(`[ConfirmRepairs] ${record.id}: repair via "${record.strategy}" did not hold — restored the pre-repair config.`);
    } catch (err: any) {
      console.error(`[ConfirmRepairs] ${record.id}: failed to restore previous config: ${err.message}`);
      result.stillPending.push(record.id);
    }
  }

  return result;
}

async function main() {
  const [failLogPath, ...args] = process.argv.slice(2);
  if (!failLogPath) {
    console.error('Usage: confirm_repairs.ts <failLogPath> [--cohort venue|artist]');
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const historyPath = path.join(cwd, 'data', 'repair-history.json');
  const scrapersDir = path.join(cwd, 'scrapers');
  const now = new Date().toISOString();

  const records = await loadRepairHistory(historyPath);
  if (records.length === 0) {
    console.log('[ConfirmRepairs] No repair history yet. Nothing to confirm.');
    return;
  }

  let failures: any[] = [];
  try {
    failures = JSON.parse(await fs.readFile(failLogPath, 'utf-8'));
  } catch {
    console.log('[ConfirmRepairs] No fail-log found. Leaving pending repairs untouched.');
    return;
  }
  if (!Array.isArray(failures)) failures = [];

  const cohortFlag = args.indexOf('--cohort');
  const cohort = cohortFlag >= 0 ? args[cohortFlag + 1] : undefined;
  if (cohort !== undefined && cohort !== 'venue' && cohort !== 'artist') {
    throw new Error(`Invalid cohort: ${cohort}`);
  }
  let run: ConfirmOptions['run'];
  if (cohort) {
    const manifest = await readRunManifest(path.dirname(failLogPath), cohort);
    const expectedRunId = process.env.EXPECTED_SOURCE_RUN_ID;
    const expectedRunAttempt = Number.parseInt(process.env.EXPECTED_SOURCE_RUN_ATTEMPT ?? '', 10);
    const identityMatches = manifest && (!expectedRunId || manifest.run.id === expectedRunId) &&
      (!Number.isInteger(expectedRunAttempt) || expectedRunAttempt <= 0 || manifest.run.attempt === expectedRunAttempt);
    if (manifest && identityMatches && failureLogMatchesManifest(failures, manifest)) {
      run = manifest;
    } else {
      console.warn('[ConfirmRepairs] Missing, invalid, mismatched, or wrong-run cohort manifest; pending repairs will be left untouched.');
    }
  }
  const failingIds = new Set(failures.map((f) => f?.id).filter((id): id is string => typeof id === 'string'));
  const result = await confirmRepairs(records, failingIds, scrapersDir, now, {
    cohort: cohort as ScraperCohort | undefined,
    run,
    dryRun: process.env.REPAIR_ROLLBACK_DRY_RUN === '1'
  });
  await saveRepairHistory(historyPath, records);

  console.log(
    `[ConfirmRepairs] confirmed=${result.confirmed.length} reverted=${result.reverted.length} ` +
    `stillPending=${result.stillPending.length}`
  );
  if (result.reverted.length > 0) {
    console.log(`[ConfirmRepairs] Rolled back: ${result.reverted.join(', ')}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ConfirmRepairs] Fatal: ${err.message}`);
    process.exit(1);
  });
}
