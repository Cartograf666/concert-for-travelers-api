import * as fs from 'fs/promises';
import * as path from 'path';
import * as dns from 'dns/promises';
import { repairScraperConfig } from './healing/repair.js';
import { classifyFailure, FailureEntry, RepairStrategy } from './healing/classify.js';
import { proposeRepairCandidates, StrategyDeps } from './healing/strategies.js';
import { verifyConfigLive, formatVerifyReport, VerifyReport } from './healing/verify.js';
import { chainSelectorRepair } from './healing/chain.js';
import {
  loadRepairHistory, saveRepairHistory, failedStrategiesFor, RepairRecord
} from './healing/history.js';
import { getGeminiKeys } from './engine/gemini_keys.js';
import { runScraper, closeBrowser, fetchHtmlForHealing, resetDomainCircuit } from './engine/runner.js';
import { resetLlmFallbackBudget } from './engine/llm_extraction_fallback.js';
import { loadCache } from './engine/cache.js';
import { ScraperConfig, ScraperConfigSchema } from './schemas/config.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

/**
 * Wall-clock ceiling for the whole healing pass. Every candidate costs a live
 * fetch of a third-party site, and a bad day can produce 80+ broken scrapers --
 * without a budget the job would run until the workflow's own timeout killed it
 * mid-write. Whatever is left over is reported, never silently dropped, and the
 * next daily run picks it up.
 */
const HEAL_BUDGET_MS = Number(process.env.HEAL_BUDGET_MS ?? 40 * 60 * 1000);

interface HealOutcome {
  id: string;
  strategy: RepairStrategy;
  detail: string;
  result: 'repaired' | 'rejected' | 'skipped' | 'retire_candidate' | 'budget_exhausted';
  note: string;
  verification?: string;
}

/** Live DNS check. A fail-log message is a snapshot; the domain may have come back. */
async function hostResolves(hostname: string): Promise<boolean> {
  try {
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(configPath: string): Promise<{ config: ScraperConfig; raw: string } | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return { config: ScraperConfigSchema.parse(JSON.parse(raw)), raw };
  } catch (err: any) {
    console.warn(`[Healer] Cannot read/validate ${configPath}: ${err.message}`);
    return null;
  }
}

async function writeConfig(configPath: string, config: ScraperConfig): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function main() {
  const cwd = process.cwd();
  const reportsDir = path.join(cwd, 'reports');
  const scrapersDir = path.join(cwd, 'scrapers');
  const failLogPath = path.join(reportsDir, 'fail-log.json');
  const historyPath = path.join(cwd, 'data', 'repair-history.json');

  console.log('[Healer] Starting Self-Healing process...');

  // runScraper's own LLM extraction fallback fires on every candidate probe. During
  // healing that is pure waste: a scraper is probed up to MAX_CANDIDATES times and
  // most candidates are rejected, so the quota would go on pages we throw away --
  // while the healer's own, deliberate Gemini call (the re-selector) needs it. Zero
  // budget makes the fallback a no-op for this process only.
  resetLlmFallbackBudget(0);

  let failures: FailureEntry[] = [];
  try {
    failures = JSON.parse(await fs.readFile(failLogPath, 'utf-8'));
  } catch {
    console.log('[Healer] No failure log found. Nothing to heal.');
    return;
  }
  if (!Array.isArray(failures) || failures.length === 0) {
    console.log('[Healer] No failed scrapers in log. Nothing to heal.');
    return;
  }

  const apiKeys = getGeminiKeys();
  if (apiKeys.length === 0) {
    // Not fatal any more: the deterministic strategies (404 rediscovery, backend
    // escalation, retry escalation, render switch) need no LLM at all, and on the
    // measured fail-log they cover more failures than the re-selector does.
    console.warn('[Healer] No Gemini API key set — running deterministic strategies only, skipping LLM re-selection.');
  } else {
    console.log(`[Healer] ${apiKeys.length} Gemini key(s) available for failover.`);
  }

  // Last good event counts, so the verification gate can reject a "repair" that
  // extracts three teaser links where the venue used to yield forty shows.
  const baselineCounts = new Map<string, number>();
  try {
    const cache = await loadCache(path.join(reportsDir, 'scrape-cache.json'));
    for (const [id, entry] of Object.entries(cache)) {
      if (Array.isArray((entry as any)?.concerts)) baselineCounts.set(id, (entry as any).concerts.length);
    }
  } catch {
    console.warn('[Healer] No scrape cache in the artifact — verifying without a volume baseline.');
  }

  const history = await loadRepairHistory(historyPath);
  const deps: StrategyDeps = { hostResolves, fetchHtml: (url) => fetchHtmlForHealing(url) };

  const outcomes: HealOutcome[] = [];
  const healed: string[] = [];
  const retireCandidates: Array<{ id: string; detail: string }> = [];
  const startedAt = Date.now();

  for (const failure of failures) {
    const id = failure.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      // The fail-log is an untrusted CI artifact -- rebuild the path ourselves so a
      // tampered entry can never aim the healer at a file outside scrapers/.
      console.warn(`[Healer] Skip: invalid scraper id in fail-log: ${JSON.stringify(id)}`);
      // Still recorded, so the report's counts always add up to the fail-log length
      // and a malformed/hostile entry is visible rather than silently dropped.
      outcomes.push({
        id: String(id).slice(0, 80), strategy: 'unfixable', detail: '',
        result: 'skipped', note: 'rejected: id is not a valid scraper id'
      });
      continue;
    }

    if (Date.now() - startedAt > HEAL_BUDGET_MS) {
      outcomes.push({
        id, strategy: 'unfixable', detail: '', result: 'budget_exhausted',
        note: `not attempted: ${Math.round(HEAL_BUDGET_MS / 60000)}min healing budget exhausted; will be retried on the next daily run`
      });
      continue;
    }

    const classification = classifyFailure(failure);
    console.log(`\n--- Healing ${id} (${classification.strategy}: ${classification.detail}) ---`);

    const configPath = path.join(scrapersDir, `${id}.json`);
    const loaded = await readConfig(configPath);
    if (!loaded) {
      outcomes.push({ ...classification, id, result: 'skipped', note: 'config missing or invalid' });
      continue;
    }

    const alreadyFailed = failedStrategiesFor(history, id);
    if (alreadyFailed.has(classification.strategy)) {
      outcomes.push({
        ...classification, id, result: 'skipped',
        note: `strategy "${classification.strategy}" was already tried and rolled back for this scraper`
      });
      continue;
    }

    const verifyOptions = { baselineCount: baselineCounts.get(id) };
    let accepted: { config: ScraperConfig; report: VerifyReport; note: string } | null = null;
    let lastNote = '';

    if (classification.strategy === 'selectors') {
      if (apiKeys.length === 0) {
        outcomes.push({ ...classification, id, result: 'skipped', note: 'no Gemini key for LLM re-selection' });
        continue;
      }
      // repairScraperConfig writes the file in place (it also does the free JSON-LD
      // probe first). Verify what it produced against the live site and restore the
      // original bytes if it does not hold up -- the working tree must never keep a
      // repair the gate rejected.
      const res = await repairScraperConfig(configPath, String(failure.htmlSample ?? ''), apiKeys);
      if (!res.success || !res.config) {
        await fs.writeFile(configPath, loaded.raw, 'utf-8');
        outcomes.push({ ...classification, id, result: 'rejected', note: `repair failed: ${res.error}` });
        continue;
      }
      const report = await verifyConfigLive(res.config, (c) => runScraper(c), verifyOptions);
      if (report.ok) {
        accepted = { config: res.config, report, note: 'LLM/JSON-LD re-selection' };
      } else {
        await fs.writeFile(configPath, loaded.raw, 'utf-8');
        lastNote = `re-selection rejected by live verification -- ${formatVerifyReport(report)}`;
      }
    } else {
      const plan = await proposeRepairCandidates(loaded.config, classification, deps);
      if (plan.retire) {
        // Retirement (deleting the config and resetting the artist's tourUrl fields)
        // belongs to prune-dead-scrapers.ts: it holds the artist-db-write lock and
        // already owns that path. Recorded here for the report only.
        retireCandidates.push({ id, detail: plan.note });
        outcomes.push({ ...classification, id, result: 'retire_candidate', note: plan.note });
        continue;
      }
      if (plan.candidates.length === 0) {
        // Nothing to try is not the same as "we tried and the gate refused it" --
        // conflating them would make the report read as if the verification gate
        // were rejecting far more repairs than it actually sees.
        outcomes.push({ ...classification, id, result: 'skipped', note: plan.note });
        continue;
      }
      lastNote = plan.note;
      // A candidate that fetched cleanly and then parsed to nothing is almost
      // certainly the page we were looking for: sites that move their schedule
      // usually redesign it at the same time, so the old selectors miss. Observed
      // live on hartfordsymphony.org and henrychocomedy.com, where every
      // reachable candidate came back 'selectors_stale'. Remember the first such
      // hit and re-select on it rather than reporting the whole scraper as
      // unfixable.
      let chain: { config: ScraperConfig; htmlSample: string; reason: string } | null = null;

      for (const candidate of plan.candidates) {
        if (Date.now() - startedAt > HEAL_BUDGET_MS) {
          lastNote = `${plan.note}; stopped mid-probe on the healing budget`;
          break;
        }
        // Probing one domain repeatedly is the point here, so the per-domain
        // circuit must not carry over between candidates.
        resetDomainCircuit(candidate.domain);
        console.log(`[Healer] ${id}: probing candidate ${candidate.url} (type=${candidate.type}, client=${candidate.httpClient ?? 'axios'})`);
        const report = await verifyConfigLive(candidate, (c) => runScraper(c), verifyOptions);
        if (report.ok) {
          accepted = { config: candidate, report, note: plan.note };
          break;
        }
        if (!chain && report.htmlSample &&
            (report.failureReason === 'selectors_stale' || report.failureReason === 'csr_detected')) {
          chain = { config: candidate, htmlSample: report.htmlSample, reason: report.failureReason };
        }
        console.log(`[Healer] ${id}: candidate rejected -- ${formatVerifyReport(report)}`);
        lastNote = `${plan.note}; last candidate: ${formatVerifyReport(report)}`;
      }

      if (!accepted && chain) {
        accepted = await chainSelectorRepair(id, configPath, loaded.raw, chain, {
          repairConfig: (p, html) => repairScraperConfig(p, html, apiKeys),
          verify: (c) => {
            resetDomainCircuit(c.domain);
            return verifyConfigLive(c, (cc) => runScraper(cc), verifyOptions);
          },
          hasLlmKey: apiKeys.length > 0
        });
        if (!accepted) {
          lastNote = `${lastNote}; reached ${chain.config.url} but could not re-select on it`;
        }
      }
    }

    if (!accepted) {
      outcomes.push({ ...classification, id, result: 'rejected', note: lastNote || 'no candidate passed verification' });
      continue;
    }

    await writeConfig(configPath, accepted.config);
    healed.push(id);
    const verification = formatVerifyReport(accepted.report);
    outcomes.push({ ...classification, id, result: 'repaired', note: accepted.note, verification });

    const record: RepairRecord = {
      id,
      strategy: classification.strategy,
      repairedAt: new Date().toISOString(),
      previousConfig: JSON.parse(loaded.raw),
      status: 'pending',
      failuresSinceRepair: 0,
      note: accepted.note,
      verification
    };
    // Supersede any earlier unproven repair for this scraper; only the newest
    // pending record can be confirmed or rolled back.
    for (const r of history) {
      if (r.id === id && r.status === 'pending') r.status = 'reverted';
    }
    history.push(record);

    console.log(`[Healer] ${id}: REPAIRED via ${classification.strategy} — ${verification}`);
  }

  await closeBrowser();

  const summary = {
    generatedAt: new Date().toISOString(),
    totalFailures: failures.length,
    healed,
    retireCandidates,
    byResult: outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o.result] = (acc[o.result] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes
  };
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.writeFile(path.join(reportsDir, 'repair-report.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');

  if (healed.length > 0) {
    await saveRepairHistory(historyPath, history);
    // Sentinel the workflow checks to decide whether to open a PR at all.
    await fs.writeFile(
      path.join(reportsDir, 'repair-summary.json'),
      JSON.stringify({ healed }, null, 2),
      'utf-8'
    );
  }

  console.log('\n======================================');
  console.log(`[Healer] Complete. Repaired ${healed.length}/${failures.length}.`);
  for (const [result, count] of Object.entries(summary.byResult)) {
    console.log(`[Healer]   ${result}: ${count}`);
  }
  if (retireCandidates.length > 0) {
    console.log(`[Healer] ${retireCandidates.length} scraper(s) flagged dead for prune-dead-scrapers: ${retireCandidates.map((r) => r.id).join(', ')}`);
  }
  console.log('======================================');
}

void main().catch(async (err) => {
  await closeBrowser().catch(() => { /* best effort */ });
  console.error(err);
  process.exit(1);
});
