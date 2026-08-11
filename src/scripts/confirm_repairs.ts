/**
 * Post-merge confirmation for automated repairs.
 *
 * heal.ts proves a repair works at the moment it is made (live fetch + plausibility
 * checks). This closes the loop on the runs after: given the next daily fail-log,
 * a pending repair either disappears from it (confirmed) or keeps failing, and
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
import {
  loadRepairHistory, saveRepairHistory, RepairRecord, REVERT_AFTER_FAILURES
} from '../healing/history.js';

export interface ConfirmResult {
  confirmed: string[];
  reverted: string[];
  stillPending: string[];
}

export async function confirmRepairs(
  records: RepairRecord[],
  failingIds: Set<string>,
  scrapersDir: string,
  now: string
): Promise<ConfirmResult> {
  const result: ConfirmResult = { confirmed: [], reverted: [], stillPending: [] };

  for (const record of records) {
    if (record.status !== 'pending') continue;

    if (!failingIds.has(record.id)) {
      record.status = 'confirmed';
      result.confirmed.push(record.id);
      continue;
    }

    record.failuresSinceRepair += 1;
    if (record.failuresSinceRepair < REVERT_AFTER_FAILURES) {
      result.stillPending.push(record.id);
      continue;
    }

    record.status = 'reverted';
    record.revertedAt = now;
    result.reverted.push(record.id);

    const configPath = path.join(scrapersDir, `${record.id}.json`);
    try {
      await fs.access(configPath);
    } catch {
      // prune-dead-scrapers retired the scraper in the meantime. Restoring the old
      // config here would resurrect a config that was deliberately deleted, so only
      // the history entry is updated.
      console.warn(`[ConfirmRepairs] ${record.id}: config no longer exists, recording the rollback without restoring it.`);
      continue;
    }

    try {
      await fs.writeFile(configPath, JSON.stringify(record.previousConfig, null, 2) + '\n', 'utf-8');
      console.log(`[ConfirmRepairs] ${record.id}: repair via "${record.strategy}" did not hold — restored the pre-repair config.`);
    } catch (err: any) {
      console.error(`[ConfirmRepairs] ${record.id}: failed to restore previous config: ${err.message}`);
    }
  }

  return result;
}

async function main() {
  const [failLogPath] = process.argv.slice(2);
  if (!failLogPath) {
    console.error('Usage: confirm_repairs.ts <failLogPath>');
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

  const failingIds = new Set(
    failures.map((f) => f?.id).filter((id): id is string => typeof id === 'string')
  );

  const result = await confirmRepairs(records, failingIds, scrapersDir, now);
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
