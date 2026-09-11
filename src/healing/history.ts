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
import type { RunIdentity } from '../observability/run_manifest.js';

/**
 * 'rejected' is a repair that never landed: a candidate was generated and failed
 * verification, so no config was written. It is recorded anyway because
 * otherwise the attempt left NO durable trace -- the scraper reappeared in the
 * next day's fail-log, was classified identically, and the same Gemini cascade
 * ran and failed again. Every night, billed, indefinitely.
 */
export type RepairStatus = 'pending' | 'confirmed' | 'reverted' | 'rejected' | 'superseded';
export type ScraperCohort = 'venue' | 'artist';

export interface RepairRecord {
  id: string;
  /**
   * The scrape cohort that produced this repair. Confirmation is only valid
   * against a complete fail-log from this same cohort: an artist pass says
   * nothing about a venue scraper and vice versa.
   */
  cohort?: ScraperCohort;
  /** Repo-relative config location, retained for a guarded rollback. */
  configPath?: string;
  /** SHA-256 of the exact config written by the healer. */
  repairedConfigHash?: string;
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
  /** Last complete source run applied to this pending repair (replay guard). */
  lastProcessedRun?: RunIdentity & { generatedAt: string };
}

/** Consecutive post-repair failures tolerated before the repair is rolled back. */
export const REVERT_AFTER_FAILURES = 2;

/**
 * Rejected attempts of one strategy tolerated before that strategy is treated as
 * known-bad for a scraper. Not 1: a rejection can be a transient site outage
 * rather than a hopeless strategy, and banning on a single fluke would retire a
 * strategy that would have worked the next day.
 */
export const REJECTED_ATTEMPTS_BEFORE_SKIP = 3;

export function cohortForConfigPath(configPath: string | undefined): ScraperCohort | undefined {
  if (!configPath) return undefined;
  const normalized = configPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^scrapers\/artists\/[^/]+\.json$/.test(normalized)) return 'artist';
  if (/^scrapers\/[^/]+\.json$/.test(normalized)) return 'venue';
  return undefined;
}

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

/**
 * The retention bucket must identify the config, not just its short id. Artist
 * and venue runs may both legitimately own (for example) "the-national".
 *
 * Config paths are the most specific identity available. Records created while
 * cohort migration was in progress may have only a cohort, and truly old
 * records have neither; those intentionally stay in a separate legacy bucket
 * rather than being allowed to evict either modern config's history.
 */
function retentionKey(record: RepairRecord): string {
  const normalizedPath = record.configPath?.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedPath && cohortForConfigPath(normalizedPath)) {
    return `path:${normalizedPath}:id:${record.id}`;
  }
  if (record.cohort) return `cohort:${record.cohort}:id:${record.id}`;
  return `legacy:id:${record.id}`;
}

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
    // 'reverted' is never trimmed. It is the strong blacklist signal -- a repair
    // that landed, verified, and still broke in production -- and dropping one
    // silently un-blacklists a strategy the healer has already proven bad. They
    // are also rare. Letting the far more numerous 'rejected' records evict them
    // would have made the retention cap actively harmful.
    if (r.status === 'reverted') {
      out.push(r);
      continue;
    }
    const key = retentionKey(r);
    const kept = settledKept.get(key) ?? 0;
    if (kept >= MAX_SETTLED_PER_SCRAPER) continue;
    settledKept.set(key, kept + 1);
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
export function failedStrategiesFor(records: RepairRecord[], id: string, cohort?: ScraperCohort): Set<RepairStrategy> {
  const failed = new Set<RepairStrategy>();

  // Legacy history used globally unique ids and had no cohort field. Preserve
  // that rejection/rollback evidence during migration: a path, when present,
  // narrows it safely; an entirely legacy record remains applicable rather
  // than silently re-enabling an already exhausted paid strategy.
  const matchesCohort = (record: RepairRecord): boolean => {
    if (!cohort) return true;
    if (record.cohort) return record.cohort === cohort;
    const pathCohort = cohortForConfigPath(record.configPath);
    return pathCohort ? pathCohort === cohort : true;
  };

  // A rolled-back repair is known-bad immediately: it landed, was verified, and
  // still broke in production.
  for (const r of records) {
    if (r.id === id && r.status === 'reverted' && matchesCohort(r)) failed.add(r.strategy);
  }

  // A repair that never passed verification is weaker evidence, so it takes
  // REJECTED_ATTEMPTS_BEFORE_SKIP of them before the strategy is skipped.
  const rejectedCounts = new Map<RepairStrategy, number>();
  for (const r of records) {
    if (r.id !== id || r.status !== 'rejected' || !matchesCohort(r)) continue;
    const next = (rejectedCounts.get(r.strategy) ?? 0) + 1;
    rejectedCounts.set(r.strategy, next);
    if (next >= REJECTED_ATTEMPTS_BEFORE_SKIP) failed.add(r.strategy);
  }

  return failed;
}

/** The still-unproven repair for a scraper, if any. At most one is pending per id. */
export function pendingRecordFor(records: RepairRecord[], id: string, cohort?: ScraperCohort): RepairRecord | undefined {
  return records.find((r) => r.id === id && r.status === 'pending' && (!cohort || r.cohort === cohort));
}
