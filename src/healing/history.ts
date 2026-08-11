/**
 * Durable record of every automated repair, and the mechanism that makes a bad
 * repair self-correcting.
 *
 * The live verification gate (healing/verify.ts) proves a repair works at the
 * moment it is made. It cannot prove the repair keeps working: a site that
 * A/B-tests its markup, an anti-bot rule that trips a day later, or selectors
 * that happened to match a one-off promo block all pass the gate and then rot.
 * Before this existed nothing noticed -- a repaired-into-garbage scraper looked
 * "healthy" to prune-dead-scrapers.ts (it produced events, just wrong ones).
 *
 * So every repair stores the config it replaced. confirm_repairs.ts re-checks
 * each pending record against the next daily fail-log: still failing twice in a
 * row means the repair did not hold, and the previous config is restored. The
 * strategy that produced it is then known-bad for that scraper, so the next
 * healing run tries a different one instead of looping on the same fix.
 */

import * as fs from 'fs/promises';
import { RepairStrategy } from './classify.js';

export type RepairStatus = 'pending' | 'confirmed' | 'reverted';

export interface RepairRecord {
  id: string;
  strategy: RepairStrategy;
  repairedAt: string;
  /** Verbatim config JSON from before the repair, for a byte-exact revert. */
  previousConfig: unknown;
  status: RepairStatus;
  /** Daily runs this scraper has failed since the repair landed. */
  failuresSinceRepair: number;
  note: string;
  /** Rendered verification report at the time of the repair. */
  verification: string;
  revertedAt?: string;
}

/** Consecutive post-repair failures tolerated before the repair is rolled back. */
export const REVERT_AFTER_FAILURES = 2;

export async function loadRepairHistory(historyPath: string): Promise<RepairRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(historyPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Settled records kept per scraper. This file is committed to the repo and written
 * on every healing run, so it would otherwise grow without bound. Pending records
 * are never dropped (they still guard a live rollback), and the most recent
 * settled ones are what `failedStrategiesFor` reads, so trimming the tail costs
 * nothing but keeps the diff small.
 */
export const MAX_SETTLED_PER_SCRAPER = 10;

export function trimRepairHistory(records: RepairRecord[]): RepairRecord[] {
  const settledKept = new Map<string, number>();
  const out: RepairRecord[] = [];
  // Walk newest-first so the records that survive are the recent ones.
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.status === 'pending') {
      out.push(r);
      continue;
    }
    const kept = settledKept.get(r.id) ?? 0;
    if (kept >= MAX_SETTLED_PER_SCRAPER) continue;
    settledKept.set(r.id, kept + 1);
    out.push(r);
  }
  return out.reverse();
}

export async function saveRepairHistory(historyPath: string, records: RepairRecord[]): Promise<void> {
  await fs.writeFile(historyPath, JSON.stringify(trimRepairHistory(records), null, 2) + '\n', 'utf-8');
}

/**
 * Strategies already rolled back for this scraper. heal.ts skips these so a
 * scraper that cannot be fixed by, say, a backend swap does not burn a probe on
 * the same swap every single day.
 */
export function failedStrategiesFor(records: RepairRecord[], id: string): Set<RepairStrategy> {
  return new Set(
    records.filter((r) => r.id === id && r.status === 'reverted').map((r) => r.strategy)
  );
}

/** The still-unproven repair for a scraper, if any. At most one is pending per id. */
export function pendingRecordFor(records: RepairRecord[], id: string): RepairRecord | undefined {
  return records.find((r) => r.id === id && r.status === 'pending');
}
