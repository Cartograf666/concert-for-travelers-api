import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';
import type { ArtistEntry } from '../schemas/artist.js';
import {
  verifyEntry, applyVerdicts, defaultFetch, makeGeminiJudge, resolverHealthy, hostKillRateBreaker,
  type JudgeFn, type VerifyResult
} from '../pipeline/verify_enrichment.js';

/**
 * Verification sweep over the enriched artist DB (see verify_enrichment.ts for the
 * two-layer deterministic+grounded-LLM design and the conservative null policy).
 *
 *   verify [N]   Verify the next N un-verified artists that have any URL field,
 *                null provably-dead / wrong links, stamp `verifiedAt`. Resumable.
 *   stats        Report verification coverage across the catalog.
 *
 * Network + LLM heavy, so it is capped per run and resumable via the `verifiedAt`
 * marker -- exactly like enrich_*.ts. Writes an audit of every nulled field to
 * reports/verify-report.json (nothing is silently deleted).
 */

const DEFAULT_CAP = 300;
const CONCURRENCY = 6;
const REVERIFY_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // re-check a link at most monthly
const RETRY_INCONCLUSIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // nothing conclusive -> try again in 3 days

function hasAnyUrl(a: ArtistEntry): boolean {
  const s = a.socials || {};
  return !!(a.website || a.tourUrl || s.spotify || s.instagram || s.facebook || s.youtube || s.telegram || s.vk);
}

function needsVerify(a: ArtistEntry, nowMs: number): boolean {
  if (!hasAnyUrl(a)) return false;
  const v = (a as any).verifiedAt;
  if (v) {
    const t = Date.parse(v);
    if (Number.isFinite(t) && nowMs - t <= REVERIFY_AFTER_MS) return false;
    return true;
  }
  // Never conclusively reached (every link timed out / was blocked): retry sooner
  // than a real verification, but do not re-attempt it on every single run.
  const tried = (a as any).verifyTriedAt;
  if (tried) {
    const t = Date.parse(tried);
    if (Number.isFinite(t) && nowMs - t <= RETRY_INCONCLUSIVE_AFTER_MS) return false;
  }
  return true;
}


async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

async function cmdStats(db: ArtistEntry[]): Promise<void> {
  const nowMs = Date.now();
  const withUrl = db.filter(hasAnyUrl).length;
  const verified = db.filter((a) => (a as any).verifiedAt).length;
  const pending = db.filter((a) => needsVerify(a, nowMs)).length;
  console.log(`Artists: ${db.length}`);
  console.log(`  with any URL field : ${withUrl}`);
  console.log(`  verifiedAt stamped : ${verified}`);
  console.log(`  pending this cycle : ${pending}`);
}

async function cmdVerify(db: ArtistEntry[], cap: number): Promise<void> {
  const nowMs = Date.now();
  const now = new Date().toISOString();

  // Track the index each candidate came from. Results used to be written back by
  // lowercased-name lookup, so a single duplicate name in the DB would silently
  // apply artist A's verdicts to artist B (nulling B's live links) while A was
  // never stamped and got re-selected forever.
  const candidateIdx: number[] = [];
  for (let i = 0; i < db.length && candidateIdx.length < cap; i++) {
    if (needsVerify(db[i], nowMs)) candidateIdx.push(i);
  }
  const candidates = candidateIdx.map((i) => db[i]);
  if (candidates.length === 0) { console.log('[Verify] Nothing pending — all URL-bearing artists verified recently.'); return; }

  // Refuse to run on a degraded resolver: an ENOTFOUND storm would otherwise null
  // live links en masse. Abort cleanly; the next scheduled run retries.
  if (!(await resolverHealthy())) {
    console.error('[Verify] DNS resolver looks degraded (control domains fail to resolve) — aborting so a transient DNS blip cannot null live links. Retry next run.');
    process.exitCode = 1;
    return;
  }

  console.log(`[Verify] Verifying ${candidates.length} artist(s) (cap ${cap}, concurrency ${CONCURRENCY})...`);

  const keys = getGeminiKeys();
  // No key -> deterministic-only run: reachability still nulls dead links; the LLM
  // identity layer is skipped (judge returns nothing => reachable links kept).
  const judge: JudgeFn = keys.length > 0 ? makeGeminiJudge(keys) : async () => ({});
  if (keys.length === 0) console.warn('[Verify] No Gemini key — running deterministic reachability only (no identity checks).');

  const results = await pool(candidates, CONCURRENCY, (a) => verifyEntry(a, defaultFetch, judge));

  const audit: Array<{ name: string; field: string; url: string; reach: string; note?: string }> = [];
  let changed = 0, nulled = 0;
  const nulledByField: Record<string, number> = {};
  for (const res of results) {
    if (res.changed) changed++;
    for (const v of res.verdicts) {
      if (v.action !== 'null') continue;
      nulled++;
      nulledByField[v.field] = (nulledByField[v.field] || 0) + 1;
      audit.push({ name: res.name, field: v.field, url: v.url, reach: v.reach, note: v.note });
    }
  }

  const tripped = hostKillRateBreaker(results);
  const report = {
    generatedAt: now,
    checked: candidates.length,
    artistsChanged: changed,
    fieldsNulled: nulled,
    nulledByField,
    aborted: tripped.length > 0,
    breakerTripped: tripped,
    audit
  };

  // Report FIRST, then mutate. The audit is the only record of what a run removed;
  // writing it after the save meant a crash in between left the shards mutated and
  // the report describing the previous run.
  const reportsDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'verify-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  if (tripped.length > 0) {
    console.error(`[Verify] ABORTED — nothing written. Host(s) with an implausible kill rate: ${tripped.join(', ')}.`);
    console.error(`[Verify] A platform does not delete ~all of the profiles we hold; a filtered resolver, a bot wall, or a dead API does. Investigate from the report before re-running.`);
    process.exitCode = 1;
    return;
  }

  for (let k = 0; k < candidates.length; k++) {
    db[candidateIdx[k]] = applyVerdicts(db[candidateIdx[k]], results[k], now);
  }
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, db);

  console.log(`[Verify] Done. checked=${candidates.length} artistsChanged=${changed} fieldsNulled=${nulled}`);
  console.log(`[Verify] Nulled by field: ${JSON.stringify(nulledByField)}`);
  console.log(`[Verify] Audit of every removed link -> reports/verify-report.json`);
}

async function main(): Promise<void> {
  await loadDotEnvFallback();
  const [cmd, arg] = process.argv.slice(2);
  const db = (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];

  if (cmd === 'stats') { await cmdStats(db); return; }
  const cap = cmd === 'verify' && arg ? Math.max(1, parseInt(arg, 10) || DEFAULT_CAP) : DEFAULT_CAP;
  await cmdVerify(db, cap);
}

main().catch((err) => { console.error('[Verify] fatal:', err); process.exitCode = 1; });
