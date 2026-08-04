import * as fs from 'fs/promises';
import * as path from 'path';
import { loadDb, saveDb, queryBatch, normName, sleep } from './enrich_wikidata_bulk.js';
import { compareEntry, type FieldComparison } from '../pipeline/ground_truth.js';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Cross-checks the links we collected against Wikidata -- see ground_truth.ts
 * for why a curated third-party source answers a question no reachability check
 * can, and why this layer is deliberately unable to delete anything.
 *
 *   crosscheck-ground-truth [N] [batch]   check the next N un-checked artists (default 4000, batch 80)
 *   crosscheck-ground-truth stats         precision summary over everything checked so far
 *
 * Reuses enrich_wikidata_bulk's batched SPARQL client, so the cost is one query
 * per `batch` artists rather than one request per link. Resumable via the
 * `groundTruthCheckedAt` marker, exactly like the enrichment passes.
 *
 * The only thing it writes to the DB is that marker plus a per-artist
 * `groundTruth` summary ({confirmed, conflict, unknown} counts). Conflicting
 * links themselves go to reports/ground-truth-report.json for adjudication.
 */

const DEFAULT_N = 4000;
const DEFAULT_BATCH = 80;
const REPORT_PATH = path.join(process.cwd(), 'reports', 'ground-truth-report.json');

interface Row { name: string; comparisons: FieldComparison[] }

function hasComparableLink(a: ArtistEntry): boolean {
  const s = (a.socials || {}) as Record<string, string | null | undefined>;
  return !!(a.website || s.spotify || s.instagram || s.facebook || s.youtube || s.vk || s.telegram);
}

function pending(db: ArtistEntry[], n: number): ArtistEntry[] {
  return db.filter((a) => hasComparableLink(a) && !(a as any).groundTruthCheckedAt).slice(0, n);
}

function summarize(rows: Row[]): { byField: Record<string, Record<string, number>>; totals: Record<string, number> } {
  const byField: Record<string, Record<string, number>> = {};
  const totals: Record<string, number> = { confirmed: 0, conflict: 0, unknown: 0 };
  for (const r of rows) {
    for (const c of r.comparisons) {
      byField[c.field] ??= { confirmed: 0, conflict: 0, unknown: 0 };
      byField[c.field][c.verdict]++;
      totals[c.verdict]++;
    }
  }
  return { byField, totals };
}

/**
 * Agreement rate over the links Wikidata actually knows about. `unknown` is
 * excluded from the denominator on purpose: a missing Wikidata property says
 * nothing about our link, and folding it in would silently dilute the score
 * toward "fine" as coverage drops.
 */
function precision(counts: Record<string, number>): string {
  const judged = counts.confirmed + counts.conflict;
  return judged === 0 ? '  n/a' : `${((counts.confirmed / judged) * 100).toFixed(1)}%`;
}

function printSummary(rows: Row[]): void {
  const { byField, totals } = summarize(rows);
  console.log(`[GroundTruth] field        confirmed  conflict   unknown   agreement`);
  for (const [field, c] of Object.entries(byField).sort((a, b) => (b[1].confirmed + b[1].conflict) - (a[1].confirmed + a[1].conflict))) {
    console.log(`              ${field.padEnd(11)}${String(c.confirmed).padStart(9)}${String(c.conflict).padStart(10)}${String(c.unknown).padStart(10)}${precision(c).padStart(12)}`);
  }
  console.log(`              ${'TOTAL'.padEnd(11)}${String(totals.confirmed).padStart(9)}${String(totals.conflict).padStart(10)}${String(totals.unknown).padStart(10)}${precision(totals).padStart(12)}`);
}

async function cmdStats(db: ArtistEntry[]): Promise<void> {
  const checked = db.filter((a) => (a as any).groundTruthCheckedAt);
  const comparable = db.filter(hasComparableLink);
  console.log(`Artists with a comparable link : ${comparable.length}`);
  console.log(`  cross-checked                : ${checked.length}`);
  console.log(`  pending                      : ${comparable.length - checked.length}`);

  const totals: Record<string, number> = { confirmed: 0, conflict: 0, unknown: 0 };
  for (const a of checked) {
    const g = (a as any).groundTruth as Record<string, number> | undefined;
    if (!g) continue;
    for (const k of Object.keys(totals)) totals[k] += g[k] || 0;
  }
  console.log(`  links confirmed / conflict / unknown : ${totals.confirmed} / ${totals.conflict} / ${totals.unknown}`);
  console.log(`  agreement where Wikidata knows       : ${precision(totals)}`);
}

async function main(): Promise<void> {
  const db = await loadDb();
  if (process.argv[2] === 'stats') { await cmdStats(db); return; }

  const n = parseInt(process.argv[2] || String(DEFAULT_N), 10);
  const batchSize = parseInt(process.argv[3] || String(DEFAULT_BATCH), 10);
  const todo = pending(db, n);
  if (todo.length === 0) { console.log('[GroundTruth] Nothing pending.'); return; }

  console.log(`[GroundTruth] ${todo.length} artists, batch ${batchSize} (${Math.ceil(todo.length / batchSize)} queries).`);
  const now = new Date().toISOString();
  const rows: Row[] = [];
  let ambiguous = 0, unmatched = 0;

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    let resolved;
    try {
      resolved = await queryBatch(batch.map((a) => a.name));
    } catch (err: any) {
      // Leave the whole batch unstamped so the next run retries it. A failed
      // query must never read as "Wikidata knows nothing about these".
      console.error(`[GroundTruth] batch ${i / batchSize + 1} failed (${err.message}); left pending.`);
      continue;
    }

    for (const entry of batch) {
      const hit = resolved.get(normName(entry.name));
      if (hit === 'ambiguous') { ambiguous++; continue; } // same name, several entities -- no verdict is safe
      if (!hit) { unmatched++; (entry as any).groundTruthCheckedAt = now; (entry as any).groundTruth = { confirmed: 0, conflict: 0, unknown: 0, source: 'not-in-wikidata' }; continue; }

      const comparisons = compareEntry(entry, { website: hit.website, socials: { ...hit.socials } });
      rows.push({ name: entry.name, comparisons });

      const counts = { confirmed: 0, conflict: 0, unknown: 0 };
      for (const c of comparisons) counts[c.verdict]++;
      (entry as any).groundTruthCheckedAt = now;
      (entry as any).groundTruth = counts;
    }

    if (i + batchSize < todo.length) await sleep(1200); // same polite spacing as enrich_wikidata_bulk.ts
  }

  const conflicts = rows
    .map((r) => ({ name: r.name, conflicts: r.comparisons.filter((c) => c.verdict === 'conflict') }))
    .filter((r) => r.conflicts.length > 0);

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify({
    generatedAt: now,
    checked: rows.length,
    ambiguousNames: ambiguous,
    notInWikidata: unmatched,
    ...summarize(rows),
    conflicts
  }, null, 2), 'utf-8');

  await saveDb(db);

  printSummary(rows);
  console.log(`[GroundTruth] ambiguous names: ${ambiguous}   not in Wikidata: ${unmatched}`);
  console.log(`[GroundTruth] ${conflicts.length} artist(s) with at least one conflicting link -> ${path.relative(process.cwd(), REPORT_PATH)}`);
  console.log(`[GroundTruth] Nothing was deleted. A conflict is evidence for adjudication, not a verdict.`);
}

main().catch((err) => { console.error('[GroundTruth] fatal:', err); process.exitCode = 1; });
