import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { checkArtistIntegrity, tallyBySeverity, tallyByRule, type IntegrityFinding } from '../pipeline/artist_integrity.js';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Layer-0 data-quality gate over the artist DB. Pure, offline, deterministic --
 * see artist_integrity.ts for why that matters and what each severity means.
 *
 *   audit-artist-integrity            report everything, always exit 0
 *   audit-artist-integrity --strict   exit 1 if the error count exceeds the baseline
 *   audit-artist-integrity --update-baseline   record today's error count as the ceiling
 *
 * The gate is a RATCHET, not a clean-slate demand. The catalog has 63k entries
 * accumulated by a dozen enrichment passes and already carries known defects; a
 * gate that fails until every one is fixed would just be switched off. Instead
 * the baseline records what exists, CI fails only on an INCREASE, and the number
 * is expected to be ratcheted down as defects get cleaned.
 */

const BASELINE_PATH = path.join(process.cwd(), 'data', 'artist-integrity-baseline.json');
const REPORT_PATH = path.join(process.cwd(), 'reports', 'artist-integrity-report.json');
const SAMPLE_PER_RULE = 5;

interface Baseline { recordedAt: string; errors: number; byRule: Record<string, number> }

async function readBaseline(): Promise<Baseline | null> {
  try { return JSON.parse(await fs.readFile(BASELINE_PATH, 'utf-8')) as Baseline; }
  catch { return null; }
}

function printSummary(findings: IntegrityFinding[]): void {
  const sev = tallyBySeverity(findings);
  const byRule = tallyByRule(findings);
  console.log(`[Integrity] errors: ${sev.error}   warnings: ${sev.warn}`);
  for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    const severity = findings.find((f) => f.rule === rule)!.severity;
    console.log(`  ${severity === 'error' ? 'E' : 'W'} ${String(n).padStart(6)}  ${rule}`);
    for (const f of findings.filter((x) => x.rule === rule).slice(0, SAMPLE_PER_RULE)) {
      console.log(`             ${f.artist}${f.field ? ` [${f.field}]` : ''} — ${f.detail}`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const updateBaseline = argv.includes('--update-baseline');

  const db = (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
  const findings = checkArtistIntegrity(db);
  const sev = tallyBySeverity(findings);
  const byRule = tallyByRule(findings);

  console.log(`[Integrity] ${db.length} artists checked (offline rules only — no network, no LLM).`);
  printSummary(findings);

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(), artists: db.length, ...sev, byRule, findings
  }, null, 2), 'utf-8');
  console.log(`[Integrity] Full report -> ${path.relative(process.cwd(), REPORT_PATH)}`);

  if (updateBaseline) {
    const baseline: Baseline = { recordedAt: new Date().toISOString(), errors: sev.error, byRule };
    await fs.writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
    console.log(`[Integrity] Baseline updated: ${sev.error} error(s) -> ${path.relative(process.cwd(), BASELINE_PATH)}`);
    return;
  }

  if (!strict) return;

  const baseline = await readBaseline();
  if (!baseline) {
    console.error(`[Integrity] No baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. Run with --update-baseline once to record the current state.`);
    process.exitCode = 1;
    return;
  }

  if (sev.error > baseline.errors) {
    console.error(`[Integrity] FAIL — errors rose from ${baseline.errors} (baseline ${baseline.recordedAt}) to ${sev.error}.`);
    for (const [rule, n] of Object.entries(byRule)) {
      const was = baseline.byRule[rule] || 0;
      if (n > was && findings.some((f) => f.rule === rule && f.severity === 'error')) {
        console.error(`  ${rule}: ${was} -> ${n}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  if (sev.error < baseline.errors) {
    console.log(`[Integrity] PASS — errors DOWN from ${baseline.errors} to ${sev.error}. Ratchet the baseline: npm run audit-artist-integrity -- --update-baseline`);
    return;
  }
  console.log(`[Integrity] PASS — ${sev.error} error(s), unchanged from baseline.`);
}

main().catch((err) => { console.error('[Integrity] fatal:', err); process.exitCode = 1; });
