import * as fs from 'fs/promises';
import * as path from 'path';
import type { VenueCache, ScrapeCache } from '../engine/cache.js';

export const SOURCE_HEALTH_SCHEMA_VERSION = 1;

export type SourceHealthSource = 'venue' | 'artist' | 'bandsintown' | 'eventbrite' | 'ticketmaster';
export type SourceHealthState = 'healthy' | 'degraded' | 'unavailable' | 'unknown' | 'not_run';
export type SourceCompleteness = 'complete' | 'partial' | 'unknown';

export interface SourceHealthCounts {
  targets: number;
  selected: number;
  attempted: number;
  succeeded: number;
  failed: number;
  empty: number;
  unavailable: number;
  skippedFresh: number;
  missing: number;
  cacheFallbacks: number;
  partial: number;
}

export interface SourceFreshness {
  /** Only an explicit successful verification advances this timestamp. */
  basis: 'verifiedAt';
  classification: 'revisit_interval' | 'current_run';
  revisitIntervalDays?: number;
  /** A revisit interval controls request cadence. It is not a stale-data SLA. */
  intervalMeaning?: 'minimum_revisit_interval_not_stale_sla';
  fresh: number;
  old: number;
  unknown: number;
  latestVerifiedAt: string | null;
  p50Days: number | null;
  p95Days: number | null;
  maxDays: number | null;
}

export interface SourceHealthIssue {
  reason: string;
  count: number;
  action: string;
}

export interface SourceHealthReport {
  schemaVersion: typeof SOURCE_HEALTH_SCHEMA_VERSION;
  generatedAt: string;
  source: SourceHealthSource;
  state: SourceHealthState;
  counts: SourceHealthCounts;
  freshness: SourceFreshness;
  completeness: SourceCompleteness;
  halted?: { category: string; count: number };
  issues: SourceHealthIssue[];
}

export interface ArtistSourceHealthBundle {
  schemaVersion: typeof SOURCE_HEALTH_SCHEMA_VERSION;
  generatedAt: string;
  sources: {
    artist: SourceHealthReport;
    bandsintown: SourceHealthReport;
    eventbrite: SourceHealthReport;
  };
}

export interface VerifiedCacheEntry {
  verifiedAt?: string;
  lastOutcome?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function emptySourceHealthCounts(overrides: Partial<SourceHealthCounts> = {}): SourceHealthCounts {
  return {
    targets: 0,
    selected: 0,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    empty: 0,
    unavailable: 0,
    skippedFresh: 0,
    missing: 0,
    cacheFallbacks: 0,
    partial: 0,
    ...overrides
  };
}

function parsedTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  return Number(values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))].toFixed(2));
}

export function buildSourceFreshness(
  keys: string[],
  cache: Readonly<Record<string, VerifiedCacheEntry | undefined>>,
  options: {
    now?: Date;
    revisitIntervalDays?: number;
    verifiedThisRun?: ReadonlySet<string>;
  } = {}
): SourceFreshness {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const unique = Array.from(new Set(keys));
  const ages: number[] = [];
  let fresh = 0;
  let old = 0;
  let unknown = 0;
  let latestMs: number | undefined;

  for (const key of unique) {
    const verifiedMs = parsedTime(cache[key]?.verifiedAt);
    if (verifiedMs === undefined) {
      unknown++;
      continue;
    }
    latestMs = latestMs === undefined ? verifiedMs : Math.max(latestMs, verifiedMs);
    const ageDays = Math.max(0, (nowMs - verifiedMs) / DAY_MS);
    ages.push(ageDays);
    if (options.revisitIntervalDays !== undefined) {
      if (ageDays <= options.revisitIntervalDays) fresh++;
      else old++;
    } else if (options.verifiedThisRun?.has(key)) {
      fresh++;
    } else {
      old++;
    }
  }

  ages.sort((left, right) => left - right);
  return {
    basis: 'verifiedAt',
    classification: options.revisitIntervalDays === undefined ? 'current_run' : 'revisit_interval',
    ...(options.revisitIntervalDays === undefined ? {} : {
      revisitIntervalDays: options.revisitIntervalDays,
      intervalMeaning: 'minimum_revisit_interval_not_stale_sla' as const
    }),
    fresh,
    old,
    unknown,
    latestVerifiedAt: latestMs === undefined ? null : new Date(latestMs).toISOString(),
    p50Days: quantile(ages, 0.5),
    p95Days: quantile(ages, 0.95),
    maxDays: quantile(ages, 1)
  };
}

export function createNotRunSourceHealth(
  source: SourceHealthSource,
  generatedAt = new Date().toISOString(),
  reason = 'not_run'
): SourceHealthReport {
  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    source,
    state: 'not_run',
    counts: emptySourceHealthCounts(),
    freshness: buildSourceFreshness([], {}, { now: new Date(generatedAt) }),
    completeness: 'unknown',
    issues: [{ reason, count: 1, action: 'wait_for_next_completed_stage' }]
  };
}

export function createUnknownSourceHealth(
  source: SourceHealthSource,
  reason: 'no_targets' | 'not_configured',
  generatedAt = new Date().toISOString()
): SourceHealthReport {
  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    source,
    state: 'unknown',
    counts: emptySourceHealthCounts(),
    freshness: buildSourceFreshness([], {}, { now: new Date(generatedAt) }),
    completeness: 'unknown',
    issues: [{ reason, count: 1, action: reason === 'no_targets' ? 'configure_source_targets' : 'configure_source' }]
  };
}

interface ScraperResultLike {
  configId: string;
  success: boolean;
  concerts: unknown[];
  reason?: string;
}

function issueAction(reason: string): string {
  switch (reason) {
    case 'fetch_error': return 'retry_and_inspect_source_access';
    case 'network_policy_block': return 'review_source_network_policy';
    case 'csr_detected': return 'use_supported_rendered_source_path';
    case 'selectors_stale': return 'repair_source_extraction';
    case 'parse_error': return 'inspect_source_format_change';
    case 'circuit_open': return 'wait_for_source_cooldown';
    default: return 'inspect_source_failure';
  }
}

/** Build venue/artist-tour diagnostics without retaining raw error strings or URLs. */
export function buildScraperSourceHealth(
  source: 'venue' | 'artist',
  results: ScraperResultLike[],
  cache: ScrapeCache,
  options: { generatedAt?: string; revisitIntervalDays?: number } = {}
): SourceHealthReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (results.length === 0) return createUnknownSourceHealth(source, 'no_targets', generatedAt);

  const verifiedThisRun = new Set<string>();
  const issueCounts = new Map<string, number>();
  let succeeded = 0;
  let failed = 0;
  let empty = 0;
  let cacheFallbacks = 0;

  for (const result of results) {
    if (result.success) {
      succeeded++;
      if (result.concerts.length === 0) empty++;
      verifiedThisRun.add(result.configId);
    } else {
      failed++;
      if (cache[result.configId]) cacheFallbacks++;
      const reason = result.reason ?? 'unknown_failure';
      issueCounts.set(reason, (issueCounts.get(reason) ?? 0) + 1);
    }
  }

  const targetIds = results.map((result) => result.configId);
  const freshnessCache: Record<string, VerifiedCacheEntry> = {};
  for (const id of targetIds) {
    const entry = cache[id];
    if (entry) freshnessCache[id] = entry;
    if (verifiedThisRun.has(id)) freshnessCache[id] = { ...freshnessCache[id], verifiedAt: generatedAt };
  }
  const freshness = buildSourceFreshness(targetIds, freshnessCache, {
    now: new Date(generatedAt),
    revisitIntervalDays: options.revisitIntervalDays,
    verifiedThisRun
  });
  const missing = Array.from(new Set(targetIds)).filter((id) => cache[id] === undefined).length;
  const incomplete = failed > 0 || missing > 0 || freshness.unknown > 0;
  const state: SourceHealthState = failed === 0 && missing === 0 && freshness.unknown === 0
    ? 'healthy'
    : succeeded === 0 && failed > 0 ? 'unavailable' : 'degraded';

  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    source,
    state,
    counts: emptySourceHealthCounts({
      targets: results.length,
      selected: results.length,
      attempted: results.length,
      succeeded,
      failed,
      empty,
      missing,
      cacheFallbacks
    }),
    freshness,
    completeness: incomplete ? 'partial' : 'complete',
    issues: Array.from(issueCounts, ([reason, count]) => ({ reason, count, action: issueAction(reason) }))
  };
}

export function buildArtistSweepSourceHealth(
  source: 'bandsintown' | 'eventbrite',
  targetKeys: string[],
  cache: Readonly<Record<string, VerifiedCacheEntry | undefined>>,
  metrics: {
    selected: number;
    attempted: number;
    succeeded: number;
    failed: number;
    empty: number;
    unavailable: number;
    skippedFresh: number;
    cacheFallbacks: number;
    partial?: number;
    haltedCategory?: string;
    issues?: Array<{ reason: string; count: number; action: string }>;
    verifiedThisRun?: ReadonlySet<string>;
  },
  options: { generatedAt?: string; revisitIntervalDays: number }
): SourceHealthReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (targetKeys.length === 0) return createUnknownSourceHealth(source, 'no_targets', generatedAt);
  const freshness = buildSourceFreshness(targetKeys, cache, {
    now: new Date(generatedAt),
    revisitIntervalDays: options.revisitIntervalDays,
    verifiedThisRun: metrics.verifiedThisRun
  });
  const missing = Array.from(new Set(targetKeys)).filter((key) => cache[key] === undefined).length;
  const previousTargetFailures = Array.from(new Set(targetKeys)).filter((key) => {
    const outcome = cache[key]?.lastOutcome;
    return outcome === 'failed' || outcome === 'unavailable';
  }).length;
  const incomplete = missing > 0 || freshness.unknown > 0 || metrics.failed > 0 ||
    metrics.unavailable > 0 || previousTargetFailures > 0 || Boolean(metrics.haltedCategory);
  let state: SourceHealthState;
  if (metrics.attempted === 0) state = incomplete ? 'unknown' : 'healthy';
  else if (metrics.succeeded === 0 && (metrics.failed > 0 || metrics.unavailable > 0)) state = 'unavailable';
  else state = incomplete ? 'degraded' : 'healthy';

  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    source,
    state,
    counts: emptySourceHealthCounts({
      targets: targetKeys.length,
      selected: metrics.selected,
      attempted: metrics.attempted,
      succeeded: metrics.succeeded,
      failed: metrics.failed,
      empty: metrics.empty,
      unavailable: metrics.unavailable,
      skippedFresh: metrics.skippedFresh,
      missing,
      cacheFallbacks: metrics.cacheFallbacks,
      partial: metrics.partial ?? 0
    }),
    freshness,
    completeness: incomplete ? 'partial' : 'complete',
    ...(metrics.haltedCategory ? { halted: { category: metrics.haltedCategory, count: 1 } } : {}),
    issues: [
      ...(metrics.issues ?? []),
      ...(previousTargetFailures > 0 ? [{
        reason: 'previous_target_failures',
        count: previousTargetFailures,
        action: 'retry_next_scheduled_sweep'
      }] : [])
    ]
  };
}

/**
 * Advance verification on every successful request, including an HTTP 304. The
 * content observation (`scrapedAt`) remains unchanged for a 304; failed attempts
 * keep the previous verification timestamp.
 */
export function verifiedVenueCacheEntry(
  entry: VenueCache,
  result: { success: boolean },
  verifiedAt = new Date().toISOString()
): VenueCache {
  return result.success ? { ...entry, verifiedAt } : entry;
}

export function createArtistSourceHealthBundle(generatedAt = new Date().toISOString()): ArtistSourceHealthBundle {
  return {
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    generatedAt,
    sources: {
      artist: createNotRunSourceHealth('artist', generatedAt),
      bandsintown: createNotRunSourceHealth('bandsintown', generatedAt),
      eventbrite: createNotRunSourceHealth('eventbrite', generatedAt)
    }
  };
}

export async function writeArtistSourceHealthBundle(
  reportsDir: string,
  bundle: ArtistSourceHealthBundle
): Promise<string> {
  const generatedAt = new Date().toISOString();
  const report: ArtistSourceHealthBundle = { ...bundle, generatedAt };
  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'artist-source-health.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  return reportPath;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNonNegativeFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_]*$/.test(value);
}

const COUNT_KEYS: Array<keyof SourceHealthCounts> = [
  'targets', 'selected', 'attempted', 'succeeded', 'failed', 'empty',
  'unavailable', 'skippedFresh', 'missing', 'cacheFallbacks', 'partial'
];

function isSourceHealthReport(raw: unknown, expectedSource: SourceHealthSource): raw is SourceHealthReport {
  if (!isObject(raw) || raw.schemaVersion !== SOURCE_HEALTH_SCHEMA_VERSION || raw.source !== expectedSource ||
      !isIsoTime(raw.generatedAt) ||
      !(['healthy', 'degraded', 'unavailable', 'unknown', 'not_run'] as unknown[]).includes(raw.state) ||
      !(['complete', 'partial', 'unknown'] as unknown[]).includes(raw.completeness)) return false;

  const counts = raw.counts;
  if (!isObject(counts) || !COUNT_KEYS.every((key) => isNonNegativeInteger(counts[key]))) return false;

  const freshness = raw.freshness;
  if (!isObject(freshness) || freshness.basis !== 'verifiedAt' ||
      (freshness.classification !== 'revisit_interval' && freshness.classification !== 'current_run') ||
      !isNonNegativeInteger(freshness.fresh) || !isNonNegativeInteger(freshness.old) ||
      !isNonNegativeInteger(freshness.unknown) ||
      !(freshness.latestVerifiedAt === null || isIsoTime(freshness.latestVerifiedAt)) ||
      !isNonNegativeFiniteOrNull(freshness.p50Days) ||
      !isNonNegativeFiniteOrNull(freshness.p95Days) ||
      !isNonNegativeFiniteOrNull(freshness.maxDays)) return false;
  if (freshness.classification === 'revisit_interval') {
    if (typeof freshness.revisitIntervalDays !== 'number' || !Number.isFinite(freshness.revisitIntervalDays) ||
        freshness.revisitIntervalDays < 0 || freshness.intervalMeaning !== 'minimum_revisit_interval_not_stale_sla') return false;
  } else if (freshness.revisitIntervalDays !== undefined || freshness.intervalMeaning !== undefined) return false;

  if (raw.halted !== undefined && (!isObject(raw.halted) || !isSafeId(raw.halted.category) ||
      !isNonNegativeInteger(raw.halted.count))) return false;
  if (!Array.isArray(raw.issues) || !raw.issues.every((issue) =>
    isObject(issue) && isSafeId(issue.reason) && isNonNegativeInteger(issue.count) && isSafeId(issue.action)
  )) return false;
  return true;
}

/** Best-effort reader for shared Actions cache input; malformed/legacy data is ignored. */
export async function readArtistSourceHealthBundle(reportsDir: string): Promise<ArtistSourceHealthBundle | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(reportsDir, 'artist-source-health.json'), 'utf-8'));
    if (!isObject(raw) || raw.schemaVersion !== SOURCE_HEALTH_SCHEMA_VERSION || !isIsoTime(raw.generatedAt) ||
        !isObject(raw.sources) ||
        !isSourceHealthReport(raw.sources.artist, 'artist') ||
        !isSourceHealthReport(raw.sources.bandsintown, 'bandsintown') ||
        !isSourceHealthReport(raw.sources.eventbrite, 'eventbrite')) return null;
    return raw as unknown as ArtistSourceHealthBundle;
  } catch {
    return null;
  }
}
