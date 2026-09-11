import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import type { ScraperResult } from '../engine/runner.js';

/**
 * A compact, cohort-specific record of a completed scrape.  It deliberately
 * contains diagnostics, not HTML samples: reports are shared with follow-up
 * workflows while raw response bodies can be large and sensitive.
 *
 * Keep this additive and versioned.  Consumers must tolerate a missing manifest
 * because runs created before this file existed only have fail-log.json.
 */
export const RUN_MANIFEST_VERSION = 1;
export type ScrapeCohort = 'venue' | 'artist';

export interface RunManifestFailure {
  id: string;
  configPath: string;
  reason?: string;
  error?: string;
}

export interface RunIdentity {
  id: string;
  attempt: number;
  sha?: string;
  workflow?: string;
}

export interface RunManifestOutcome extends RunManifestFailure {
  configHash: string;
  status: 'succeeded' | 'failed';
}

export interface ScrapeRunManifest {
  schemaVersion: number;
  cohort: ScrapeCohort;
  generatedAt: string;
  complete: true;
  run: RunIdentity;
  scrapers: {
    total: number;
    succeeded: number;
    failed: number;
    changed: number;
    unchanged: number;
    staleIds: string[];
  };
  outcomes: RunManifestOutcome[];
  failures: RunManifestFailure[];
}

export function manifestFileName(cohort: ScrapeCohort): string {
  return `${cohort}-run-manifest.json`;
}

export function buildRunManifest(
  cohort: ScrapeCohort,
  results: ScraperResult[],
  options: {
    changed: number;
    configHashes: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
    staleIds?: string[];
    generatedAt?: string;
    run?: Partial<RunIdentity>;
  }
): ScrapeRunManifest {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const hashFor = (id: string): string => {
    const map = options.configHashes as ReadonlyMap<string, string>;
    const hash = typeof map.get === 'function'
      ? map.get(id)
      : (options.configHashes as Readonly<Record<string, string>>)[id];
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Missing/invalid config hash for ${id}`);
    return hash;
  };
  const outcomes: RunManifestOutcome[] = results.map((result) => ({
      id: result.configId,
      configPath: cohort === 'artist'
        ? `scrapers/artists/${result.configId}.json`
        : `scrapers/${result.configId}.json`,
      configHash: hashFor(result.configId),
      status: result.success ? 'succeeded' : 'failed',
      reason: result.reason,
      error: result.error
    }));
  const failures = outcomes
    .filter((outcome) => outcome.status === 'failed')
    .map(({ id, configPath, reason, error }) => ({ id, configPath, reason, error }));

  const envAttempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? '', 10);
  const requestedAttempt = options.run?.attempt;
  const attempt = Number.isInteger(requestedAttempt) && Number(requestedAttempt) > 0
    ? Number(requestedAttempt)
    : Number.isInteger(envAttempt) && envAttempt > 0 ? envAttempt : 1;

  return {
    schemaVersion: RUN_MANIFEST_VERSION,
    cohort,
    generatedAt,
    complete: true,
    run: {
      id: options.run?.id ?? process.env.GITHUB_RUN_ID ?? `local-${generatedAt}`,
      attempt,
      ...((options.run?.sha ?? process.env.GITHUB_SHA) ? { sha: options.run?.sha ?? process.env.GITHUB_SHA } : {}),
      ...((options.run?.workflow ?? process.env.GITHUB_WORKFLOW) ? { workflow: options.run?.workflow ?? process.env.GITHUB_WORKFLOW } : {})
    },
    scrapers: {
      total: results.length,
      succeeded: results.length - failures.length,
      failed: failures.length,
      changed: options.changed,
      unchanged: results.filter((result) => result.success && result.notModified).length,
      staleIds: options.staleIds ?? []
    },
    outcomes,
    failures
  };
}

/** Hash the exact config bytes executed by a cohort, not a re-serialized approximation. */
export async function hashRunConfigs(configsDir: string, ids: string[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const id of ids) {
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error(`Invalid scraper id in run result: ${id}`);
    const raw = await fs.readFile(path.join(configsDir, `${id}.json`));
    hashes.set(id, createHash('sha256').update(raw).digest('hex'));
  }
  return hashes;
}

export async function writeRunManifest(reportsDir: string, manifest: ScrapeRunManifest): Promise<string> {
  await fs.mkdir(reportsDir, { recursive: true });
  const manifestPath = path.join(reportsDir, manifestFileName(manifest.cohort));
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifestPath;
}

/** Best-effort compatibility reader for manifests from shared Actions caches. */
export async function readRunManifest(reportsDir: string, cohort: ScrapeCohort): Promise<ScrapeRunManifest | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(reportsDir, manifestFileName(cohort)), 'utf-8'));
    return isRunManifest(raw, cohort) ? raw : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

/** Strict v1 validation: cached/partial manifests are untrusted workflow input. */
export function isRunManifest(raw: unknown, cohort: ScrapeCohort): raw is ScrapeRunManifest {
  if (!isObject(raw) || raw.schemaVersion !== RUN_MANIFEST_VERSION || raw.cohort !== cohort || raw.complete !== true) return false;
  if (typeof raw.generatedAt !== 'string' || !Number.isFinite(Date.parse(raw.generatedAt))) return false;
  if (!isObject(raw.run) || typeof raw.run.id !== 'string' || raw.run.id.trim().length === 0 ||
      !Number.isInteger(raw.run.attempt) || Number(raw.run.attempt) <= 0) return false;
  if (raw.run.sha !== undefined && typeof raw.run.sha !== 'string') return false;
  if (raw.run.workflow !== undefined && typeof raw.run.workflow !== 'string') return false;
  if (!isObject(raw.scrapers)) return false;
  const { total, succeeded, failed, changed, unchanged, staleIds } = raw.scrapers;
  if (![total, succeeded, failed, changed, unchanged].every(isNonNegativeInteger) || !Array.isArray(staleIds)) return false;
  if (Number(total) !== Number(succeeded) + Number(failed) || Number(succeeded) !== Number(changed) + Number(unchanged)) return false;
  if (!staleIds.every((id) => typeof id === 'string') || new Set(staleIds).size !== staleIds.length) return false;
  if (!Array.isArray(raw.outcomes) || raw.outcomes.length !== total || !Array.isArray(raw.failures) || raw.failures.length !== failed) return false;

  const expectedPath = (id: string) => cohort === 'artist'
    ? `scrapers/artists/${id}.json`
    : `scrapers/${id}.json`;
  const outcomeById = new Map<string, RunManifestOutcome>();
  for (const value of raw.outcomes) {
    if (!isObject(value) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(value.id) ||
        value.configPath !== expectedPath(value.id) || typeof value.configHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.configHash) || (value.status !== 'succeeded' && value.status !== 'failed') ||
        (value.reason !== undefined && typeof value.reason !== 'string') ||
        (value.error !== undefined && typeof value.error !== 'string') || outcomeById.has(value.id)) return false;
    outcomeById.set(value.id, value as unknown as RunManifestOutcome);
  }
  if (!staleIds.every((id) => outcomeById.has(id))) return false;

  const failureIds = new Set<string>();
  for (const value of raw.failures) {
    const outcome = isObject(value) && typeof value.id === 'string' ? outcomeById.get(value.id) : undefined;
    if (!isObject(value) || typeof value.id !== 'string' || value.configPath !== expectedPath(value.id) ||
        (value.reason !== undefined && typeof value.reason !== 'string') ||
        (value.error !== undefined && typeof value.error !== 'string') || failureIds.has(value.id) ||
        outcome?.status !== 'failed' || outcome.reason !== value.reason || outcome.error !== value.error) return false;
    failureIds.add(value.id);
  }
  return Array.from(outcomeById.values()).every((outcome) =>
    (outcome.status === 'failed') === failureIds.has(outcome.id)
  );
}

/** Ensure the richer healer artifact describes exactly the manifest's failures. */
export function failureLogMatchesManifest(raw: unknown, manifest: ScrapeRunManifest): boolean {
  if (!Array.isArray(raw) || raw.length !== manifest.failures.length) return false;
  const expected = new Map(manifest.failures.map((failure) => [failure.id, failure]));
  const seen = new Set<string>();
  for (const value of raw) {
    if (!isObject(value) || typeof value.id !== 'string' || seen.has(value.id)) return false;
    const failure = expected.get(value.id);
    if (!failure || value.configPath !== failure.configPath || value.reason !== failure.reason || value.error !== failure.error) return false;
    seen.add(value.id);
  }
  return seen.size === expected.size;
}

export function sourceHealth(manifest: ScrapeRunManifest | null): Record<string, unknown> | null {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    cohort: manifest.cohort,
    total: manifest.scrapers.total,
    succeeded: manifest.scrapers.succeeded,
    failed: manifest.scrapers.failed,
    changed: manifest.scrapers.changed,
    unchanged: manifest.scrapers.unchanged,
    stale: manifest.scrapers.staleIds.length
  };
}
