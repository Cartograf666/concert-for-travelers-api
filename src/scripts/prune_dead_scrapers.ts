import * as fs from 'fs/promises';
import * as path from 'path';
import * as dns from 'dns/promises';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { ArtistEntry } from '../schemas/artist.js';
import { classifyFailure } from '../healing/classify.js';
import { ScraperCohort } from '../healing/history.js';
import {
  failureLogMatchesManifest, readRunManifest, RunIdentity, ScrapeRunManifest
} from '../observability/run_manifest.js';

/**
 * `heal.ts` deliberately skips `fetch_error`/`csr_detected`/`circuit_open`
 * failures -- re-selecting CSS selectors can't fix a page that never loaded.
 * Those scrapers just sit failing forever with nothing tracking how long,
 * silently costing daily scrape time and never contributing data. This
 * tracks a consecutive-failure streak per scraper across runs and, once a
 * streak crosses PRUNE_THRESHOLD days, retires the config and resets the
 * matching artist's tourUrl-related markers so discover_tour_urls.ts /
 * extract_tour_scrapers.ts can find and re-generate a fresh one later --
 * rather than leaving a permanently-dead scraper (and a permanently-stale
 * tourUrl) in place forever.
 *
 * Scope: only auto-generated `artist-<slug>` scrapers (extract_tour_scrapers.ts's
 * own id convention) are eligible for auto-pruning. Hand-authored venue
 * scrapers and the small set of manually-authored artist tour-page scrapers
 * (which use descriptive ids, not the artist-<slug> shape) are never touched
 * here -- those went through a human, this only auto-removes what was
 * auto-created without one.
 */
const PRUNE_THRESHOLD = 5;
const ID_RE = /^artist-[a-z0-9][a-z0-9-]{0,80}$/;
const PRUNABLE_REASONS = new Set(['fetch_error', 'csr_detected', 'circuit_open']);

export interface ScraperHealthEntry {
  id: string;
  /** Kept separate because an absent ID only proves recovery in this cohort. */
  cohort?: ScraperCohort;
  configPath?: string;
  consecutiveFailures: number;
  lastReason: string;
  firstFailedAt: string;
  lastFailedAt: string;
}

interface ScraperHealthState {
  schemaVersion: 2;
  entries: ScraperHealthEntry[];
  lastProcessedRuns: Partial<Record<ScraperCohort, RunIdentity & { generatedAt: string }>>;
}

export type HealthUpdate = ScraperHealthEntry[] & { readonly runApplied: boolean };

export interface PruneResult {
  pruned: string[];
  stillFailing: string[];
  recovered: string[];
  wouldPrune?: string[];
  pruneFailed?: string[];
}

function isEligible(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

function configIdentity(
  id: string,
  configPath: unknown,
  fallbackCohort?: ScraperCohort
): { cohort: ScraperCohort; configPath: string } | null {
  const normalized = typeof configPath === 'string'
    ? configPath.replace(/\\/g, '/').replace(/^\.\//, '')
    : '';
  if (normalized === `scrapers/${id}.json`) return { cohort: 'venue', configPath: normalized };
  if (normalized === `scrapers/artists/${id}.json`) return { cohort: 'artist', configPath: normalized };
  if (fallbackCohort === 'artist') {
    return { cohort: 'artist', configPath: `scrapers/artists/${id}.json` };
  }
  if (fallbackCohort === 'venue') {
    return { cohort: 'venue', configPath: `scrapers/${id}.json` };
  }
  return null;
}

export async function updateScraperHealth(
  healthPath: string,
  failures: Array<{ id: string; reason?: string; configPath?: string }>,
  now: string,
  cohort: ScraperCohort = 'artist',
  options: { run?: Pick<ScrapeRunManifest, 'generatedAt' | 'run' | 'outcomes'>; dryRun?: boolean } = {}
): Promise<HealthUpdate> {
  let health: ScraperHealthEntry[] = [];
  let lastProcessedRuns: ScraperHealthState['lastProcessedRuns'] = {};
  try {
    const raw: unknown = JSON.parse(await fs.readFile(healthPath, 'utf-8'));
    if (Array.isArray(raw)) {
      health = raw as ScraperHealthEntry[];
    } else if (raw && typeof raw === 'object' && (raw as any).schemaVersion === 2 && Array.isArray((raw as any).entries)) {
      health = (raw as ScraperHealthState).entries;
      lastProcessedRuns = (raw as ScraperHealthState).lastProcessedRuns ?? {};
    }
  } catch {
    // No prior health file -- start fresh.
  }

  const finish = (entries: ScraperHealthEntry[], runApplied: boolean): HealthUpdate => {
    Object.defineProperty(entries, 'runApplied', { value: runApplied, enumerable: false });
    return entries as HealthUpdate;
  };
  if (options.run) {
    const prior = lastProcessedRuns[cohort];
    const runAt = Date.parse(options.run.generatedAt);
    const priorAt = prior ? Date.parse(prior.generatedAt) : NaN;
    const sameRun = prior && prior.id === options.run.run.id && prior.attempt === options.run.run.attempt;
    if (!Number.isFinite(runAt) || sameRun || (Number.isFinite(priorAt) && runAt <= priorAt)) {
      return finish(health, false);
    }
  }
  const failureIdentities = new Map<string, { cohort: ScraperCohort; configPath: string }>();
  for (const failure of failures) {
    if (!isEligible(failure.id) || !PRUNABLE_REASONS.has(failure.reason ?? '')) continue;
    const identity = configIdentity(failure.id, failure.configPath, cohort);
    if (identity?.cohort === cohort) failureIdentities.set(failure.id, identity);
  }

  // Older health entries have neither cohort nor path. Migrate them only when
  // this cohort's current complete fail-log identifies the same scraper. An
  // absent entry is ambiguous in the legacy shared file, so it stays untouched
  // instead of being falsely "recovered" by whichever workflow ran first.
  const byId = new Map<string, ScraperHealthEntry>();
  for (const raw of Array.isArray(health) ? health : []) {
    if (!raw || !isEligible(raw.id)) continue;
    const recorded = configIdentity(raw.id, raw.configPath);
    const observed = failureIdentities.get(raw.id);
    const identity = recorded ?? observed;
    const migrated: ScraperHealthEntry = {
      ...raw,
      ...(identity ? { cohort: identity.cohort, configPath: identity.configPath } : {})
    };
    const key = `${migrated.cohort ?? 'legacy'}:${migrated.id}`;
    byId.set(key, migrated);
  }

  const failingIds = new Set(failureIdentities.keys());
  const observedIds = options.run
    ? new Set(options.run.outcomes?.map((outcome) => outcome.id) ?? [])
    : null;

  // Reset a streak only when this complete run explicitly tested the config and
  // it no longer has a prunable failure. Absence may mean deleted/not-loaded.
  for (const [key, entry] of Array.from(byId.entries())) {
    if (entry.cohort === cohort && !failingIds.has(entry.id) &&
        (!observedIds || observedIds.has(entry.id))) byId.delete(key);
  }

  for (const failure of failures) {
    if (!isEligible(failure.id) || !PRUNABLE_REASONS.has(failure.reason ?? '')) continue;
    const identity = failureIdentities.get(failure.id);
    if (!identity) continue;
    const key = `${cohort}:${failure.id}`;
    const legacyKey = `legacy:${failure.id}`;
    const existing = byId.get(key) ?? byId.get(legacyKey);
    if (existing) {
      byId.delete(legacyKey);
      existing.cohort = identity.cohort;
      // A current, validated fail-log path is the migration authority. Updating
      // it fixes legacy entries that previously pointed at scrapers/<id>.json
      // even though the artist config had moved under scrapers/artists/.
      existing.configPath = identity.configPath;
      existing.consecutiveFailures += 1;
      existing.lastReason = failure.reason!;
      existing.lastFailedAt = now;
      byId.set(key, existing);
    } else {
      byId.set(key, {
        id: failure.id,
        cohort: identity.cohort,
        configPath: identity.configPath,
        consecutiveFailures: 1,
        lastReason: failure.reason!,
        firstFailedAt: now,
        lastFailedAt: now
      });
    }
  }

  const updated = Array.from(byId.values());
  if (!options.dryRun) {
    if (options.run) {
      lastProcessedRuns[cohort] = { ...options.run.run, generatedAt: options.run.generatedAt };
    }
    const state: ScraperHealthState = { schemaVersion: 2, entries: updated, lastProcessedRuns };
    await fs.writeFile(healthPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  }
  return finish(updated, true);
}

/**
 * Scrapers whose domain is provably gone, retired immediately instead of serving
 * out the PRUNE_THRESHOLD-day streak.
 *
 * A streak is the right instrument for "keeps failing for reasons we can't read",
 * but NXDOMAIN is not ambiguous: the name no longer exists, so five more days of
 * daily requests buy no information. On the 2026-07-24 fail-log this covered 18 of
 * 84 failures (17x ENOTFOUND plus one domain re-parked on 127.0.0.1) that would
 * otherwise have kept consuming scrape time and blocking the artist's tourUrl from
 * being re-discovered.
 *
 * The fail-log message alone is not enough to delete a config -- a CI resolver
 * hiccup produces a similar-looking error -- so every candidate is re-checked live
 * against DNS here, and only a second confirmed failure retires it.
 */
export async function selectImmediateDeaths(
  failures: Array<{ id?: unknown; reason?: string; error?: string; configPath?: string }>,
  scrapersDir: string,
  resolveHost: (hostname: string) => Promise<boolean>,
  now: string
): Promise<ScraperHealthEntry[]> {
  const deaths: ScraperHealthEntry[] = [];

  for (const failure of failures) {
    if (!isEligible(failure.id)) continue;
    if (classifyFailure(failure).strategy !== 'dead_domain') continue;

    let hostname: string;
    try {
      const raw = await fs.readFile(resolveConfigPath(scrapersDir, failure), 'utf-8');
      hostname = new URL(JSON.parse(raw).url).hostname;
    } catch {
      continue; // config already gone or unreadable -- nothing to retire
    }

    if (await resolveHost(hostname)) {
      console.log(`[PruneDeadScrapers] ${failure.id}: ${hostname} resolves again, not retiring.`);
      continue;
    }

    console.log(`[PruneDeadScrapers] ${failure.id}: ${hostname} confirmed dead (NXDOMAIN) — retiring immediately.`);
    deaths.push({
      id: failure.id,
      configPath: typeof failure.configPath === 'string' ? failure.configPath : undefined,
      consecutiveFailures: PRUNE_THRESHOLD,
      lastReason: 'dead_domain',
      firstFailedAt: now,
      lastFailedAt: now
    });
  }

  return deaths;
}

async function hostResolves(hostname: string): Promise<boolean> {
  try {
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a failure to its config file. Venue configs live in scrapers/ and
 * artist tour-page configs in scrapers/artists/, so reconstructing the path from
 * the id alone pointed at a non-existent file for every artist config -- the
 * streak was tracked but the retirement then silently did nothing. The fail-log
 * records the real path; prefer it and keep the old reconstruction as a fallback
 * for a fail-log written before that field existed.
 */
export function resolveConfigPath(scrapersDir: string, failure: { id?: unknown; configPath?: unknown }): string {
  const id = typeof failure.id === 'string' ? failure.id : '';
  const reported = typeof failure.configPath === 'string' ? failure.configPath.replace(/\\/g, '/').replace(/^\.\//, '') : '';
  const allowed = [`scrapers/${id}.json`, `scrapers/artists/${id}.json`];
  if (allowed.includes(reported)) return path.resolve(path.dirname(scrapersDir), reported);
  return path.join(scrapersDir, `${failure.id}.json`);
}

async function findArtistScraperConfigDomain(configPath: string): Promise<string | null> {
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    const name = config?.selectors?.artistNameFallback;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export async function pruneDeadScrapers(
  scrapersDir: string,
  healthEntries: ScraperHealthEntry[],
  artistDbDir: string,
  auditPath: string,
  now: string,
  options: { dryRun?: boolean } = {}
): Promise<PruneResult> {
  // Eligibility is the auto-generated artist id convention, not the directory:
  // dozens of legacy auto-generated artist configs still live directly under
  // scrapers/ and are exercised by the venue run.
  const toPrune = healthEntries.filter((h) => isEligible(h.id) && h.consecutiveFailures >= PRUNE_THRESHOLD);
  const stillFailing = healthEntries.filter((h) => h.consecutiveFailures < PRUNE_THRESHOLD).map((h) => h.id);

  if (toPrune.length === 0) {
    return { pruned: [], stillFailing, recovered: [] };
  }

  const artists = await loadApprovedArtists(artistDbDir) as ArtistEntry[];
  // Map to an array of indices, not a single index -- a name collision (two DB
  // entries sharing a case-insensitive name) must never silently pick one and
  // reset the wrong artist's fields. Ambiguous matches are skipped entirely
  // below rather than guessed at.
  const indicesByNameLower = new Map<string, number[]>();
  artists.forEach((a, i) => {
    const key = String(a.name ?? '').toLowerCase();
    const list = indicesByNameLower.get(key);
    if (list) list.push(i);
    else indicesByNameLower.set(key, [i]);
  });

  let audit: any[] = [];
  try {
    audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
  } catch {
    // No prior audit file -- start fresh.
  }

  const pruned: string[] = [];
  const pruneFailed: string[] = [];
  for (const entry of toPrune) {
    const configPath = resolveConfigPath(scrapersDir, entry);
    const artistName = await findArtistScraperConfigDomain(configPath);

    if (options.dryRun) {
      console.log(`[PruneDeadScrapers] ${entry.id}: would prune ${configPath} (dry run).`);
      continue;
    }

    try {
      await fs.rm(configPath);
    } catch (err: any) {
      // Do not reset artist discovery state or claim a successful retirement
      // when the config is still present (or its deletion could not be proven).
      console.warn(`[PruneDeadScrapers] ${entry.id}: failed to delete ${configPath}: ${err?.message ?? err}`);
      pruneFailed.push(entry.id);
      if (!stillFailing.includes(entry.id)) stillFailing.push(entry.id);
      continue;
    }

    if (artistName) {
      const indices = indicesByNameLower.get(artistName.toLowerCase());
      if (indices?.length === 1) {
        const artist = artists[indices[0]];
        delete artist.tourUrl;
        delete artist.tourScraperTriedAt;
        delete artist.tourScraperCreatedAt;
        delete artist.tourUrlProbeTriedAt; // let discover_tour_urls.ts re-probe from scratch
      } else if (indices && indices.length > 1) {
        console.warn(
          `[PruneDeadScrapers] Skipping artist-field reset for "${artistName}" -- ` +
          `${indices.length} DB entries share this name case-insensitively, can't tell ` +
          `which one owns the pruned scraper without guessing.`
        );
      }
    }

    audit.push({
      id: entry.id,
      artistName,
      reason: entry.lastReason,
      consecutiveFailures: entry.consecutiveFailures,
      firstFailedAt: entry.firstFailedAt,
      prunedAt: now
    });
    pruned.push(entry.id);
  }

  if (pruned.length > 0) {
    await saveApprovedArtists(artistDbDir, artists);
    await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + '\n', 'utf-8');
  }

  return {
    pruned,
    stillFailing,
    recovered: [],
    wouldPrune: options.dryRun ? toPrune.map((h) => h.id) : undefined,
    pruneFailed: pruneFailed.length > 0 ? pruneFailed : undefined
  };
}

async function removePrunedFromHealth(
  healthPath: string,
  cohort: ScraperCohort,
  prunedIds: string[]
): Promise<void> {
  if (prunedIds.length === 0) return;
  const raw: unknown = JSON.parse(await fs.readFile(healthPath, 'utf-8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as any).schemaVersion !== 2) return;
  const state = raw as ScraperHealthState;
  const pruned = new Set(prunedIds);
  state.entries = state.entries.filter((entry) => entry.cohort !== cohort || !pruned.has(entry.id));
  await fs.writeFile(healthPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

async function main() {
  const [failLogPath, ...args] = process.argv.slice(2);
  if (!failLogPath) {
    console.error('Usage: prune_dead_scrapers.ts <failLogPath> [--cohort artist|venue]');
    process.exitCode = 1;
    return;
  }

  const now = new Date().toISOString();
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const healthPath = path.join(process.cwd(), 'data', 'scraper-health.json');
  const auditPath = path.join(process.cwd(), 'data', 'pruned-scrapers.json');

  let failures: any[] = [];
  try {
    failures = JSON.parse(await fs.readFile(failLogPath, 'utf-8'));
  } catch {
    console.log('[PruneDeadScrapers] No fail-log found. Nothing to track.');
    return;
  }
  if (!Array.isArray(failures)) failures = [];

  const cohortFlag = args.indexOf('--cohort');
  const cohort = cohortFlag >= 0 ? args[cohortFlag + 1] : 'artist';
  if (cohort !== 'artist' && cohort !== 'venue') throw new Error(`Invalid cohort: ${cohort}`);
  const manifest = await readRunManifest(path.dirname(failLogPath), cohort);
  if (!manifest || !failureLogMatchesManifest(failures, manifest)) {
    throw new Error('Missing, incomplete, or mismatched cohort run manifest; refusing to update health.');
  }
  const expectedRunId = process.env.EXPECTED_SOURCE_RUN_ID;
  const expectedRunAttempt = Number.parseInt(process.env.EXPECTED_SOURCE_RUN_ATTEMPT ?? '', 10);
  if ((expectedRunId && manifest.run.id !== expectedRunId) ||
      (Number.isInteger(expectedRunAttempt) && expectedRunAttempt > 0 && manifest.run.attempt !== expectedRunAttempt)) {
    throw new Error('Run manifest identity does not match the triggering workflow run.');
  }
  const dryRun = process.env.PRUNE_DEAD_SCRAPERS_DRY_RUN === '1';
  const health = await updateScraperHealth(healthPath, failures, now, cohort, { run: manifest, dryRun });
  if (!health.runApplied) {
    console.log(`[PruneDeadScrapers] Ignoring replayed or stale source run ${manifest.run.id}:${manifest.run.attempt}.`);
    return;
  }

  // Confirmed-dead domains jump the streak. Merged by id so a scraper that is both
  // streak-tracked and DNS-dead is retired once, not twice.
  const deaths = await selectImmediateDeaths(failures, scrapersDir, hostResolves, now);
  const byId = new Map(health.map((h) => [`${h.cohort ?? 'artist'}:${h.id}`, h]));
  for (const d of deaths) byId.set(`${cohort}:${d.id}`, { ...(byId.get(`${cohort}:${d.id}`) ?? d), ...d, cohort });

  // This artifact only proves failures for its own cohort. Never retire a
  // scraper merely because a different scheduled job happened to run today.
  const cohortHealth = Array.from(byId.values()).filter((entry) => entry.cohort === cohort);
  const result = await pruneDeadScrapers(scrapersDir, cohortHealth, PRODUCTION_ARTIST_DB_DIR, auditPath, now, {
    dryRun
  });
  if (!dryRun) await removePrunedFromHealth(healthPath, cohort, result.pruned);

  console.log(
    `[PruneDeadScrapers] pruned=${result.pruned.length} (${result.pruned.join(', ') || 'none'}), ` +
    `immediateDeadDomains=${deaths.length}, stillTracking=${result.stillFailing.length}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[PruneDeadScrapers] Fatal: ${err.message}`);
    process.exit(1);
  });
}
