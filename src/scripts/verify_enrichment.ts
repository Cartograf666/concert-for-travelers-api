import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { getGeminiKeys, loadDotEnvFallback } from '../engine/gemini_keys.js';
import type { ArtistEntry } from '../schemas/artist.js';
import {
  verifyEntry, applyVerdicts, defaultFetch, makeGeminiJudge, resolverHealthy, type JudgeFn, type VerifyResult
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

function hasAnyUrl(a: ArtistEntry): boolean {
  const s = a.socials || {};
  return !!(a.website || a.tourUrl || s.spotify || s.instagram || s.facebook || s.youtube || s.telegram || s.vk);
}

function needsVerify(a: ArtistEntry, nowMs: number): boolean {
  if (!hasAnyUrl(a)) return false;
  const v = (a as any).verifiedAt;
  if (!v) return true;
  const t = Date.parse(v);
  return !Number.isFinite(t) || nowMs - t > REVERIFY_AFTER_MS;
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

  const candidates = db.filter((a) => needsVerify(a, nowMs)).slice(0, cap);
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

  const byName = new Map(db.map((a, i) => [a.name.toLowerCase(), i]));
  const results = await pool(candidates, CONCURRENCY, (a) => verifyEntry(a, defaultFetch, judge));

  const audit: Array<{ name: string; field: string; url: string; reach: string; note?: string }> = [];
  let changed = 0, nulled = 0;
  const nulledByField: Record<string, number> = {};

  for (let k = 0; k < candidates.length; k++) {
    const res: VerifyResult = results[k];
    const idx = byName.get(candidates[k].name.toLowerCase());
    if (idx === undefined) continue;
    db[idx] = applyVerdicts(db[idx], res, now);
    if (res.changed) changed++;
    for (const v of res.verdicts) {
      if (v.action === 'null') {
        nulled++;
        nulledByField[v.field] = (nulledByField[v.field] || 0) + 1;
        audit.push({ name: res.name, field: v.field, url: v.url, reach: v.reach, note: v.note });
      }
    }
  }

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, db);

  const reportsDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'verify-report.json'), JSON.stringify({ generatedAt: now, checked: candidates.length, artistsChanged: changed, fieldsNulled: nulled, nulledByField, audit }, null, 2), 'utf-8');

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
