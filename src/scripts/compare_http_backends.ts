/**
 * Measurement tool for the got-scraping fetch backend (Phase 2).
 *
 * Answers one question before any rollout: does got-scraping's browser-header
 * fingerprint actually recover venues that the default axios path currently
 * fails to fetch/parse? Runs the FULL runScraper pipeline (fetch + parse +
 * JSON-LD fallback) per backend, so a "recovered" verdict means real concerts
 * were extracted, not merely that the HTTP status improved.
 *
 * Usage:
 *   npm run compare-backends                 # failing-only: axios first, retry only the failures on got
 *   npm run compare-backends -- --all        # run BOTH backends on every config (also catches regressions)
 *   npm run compare-backends -- id-a id-b    # only these config ids (both backends)
 *
 * Live network, real SSRF guard (no SCRAPER_ALLOW_LOCAL_HOSTS). Polite: low
 * concurrency, and failing-only mode never double-hits a site that already works.
 */
import * as path from 'path';
import { loadConfigs, runScraper, closeBrowser } from '../engine/runner.js';
import type { ScraperResult } from '../engine/runner.js';
import type { ScraperConfig } from '../schemas/config.js';

const CONCURRENCY = 3;

interface Outcome {
  id: string;
  ok: boolean;
  count: number;
  reason?: string;
  error?: string;
}

function summarize(id: string, res: ScraperResult): Outcome {
  return {
    id,
    ok: res.success && res.concerts.length > 0,
    count: res.concerts.length,
    reason: res.reason,
    error: res.error?.slice(0, 120)
  };
}

async function runWithBackend(config: ScraperConfig, backend: 'axios' | 'got-scraping'): Promise<Outcome> {
  // Clone so the per-config override drives resolveHttpBackend without mutating
  // the loaded config (the other backend pass reuses the original object).
  const cfg: ScraperConfig = { ...config, httpClient: backend };
  try {
    const res = await runScraper(cfg); // no cache -> always performs a real fetch
    return summarize(config.id, res);
  } catch (err: any) {
    return { id: config.id, ok: false, count: 0, error: String(err?.message || err).slice(0, 120) };
  }
}

/** Minimal fixed-size worker pool: maps items through `fn`, at most N in flight. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const allMode = argv.includes('--all');
  const idFilter = new Set(argv.filter((a) => !a.startsWith('--')));

  const scrapersDir = path.join(process.cwd(), 'scrapers');
  let configs = await loadConfigs(scrapersDir);

  // playwright_render ignores the HTTP backend (it renders in Chromium), so it can
  // never differ between axios and got -- exclude it to avoid noise and wasted renders.
  configs = configs.filter((c) => c.type !== 'playwright_render');
  if (idFilter.size > 0) configs = configs.filter((c) => idFilter.has(c.id));

  if (configs.length === 0) {
    console.log('No matching (non-playwright) configs to compare.');
    return;
  }

  console.log(`[compare] ${configs.length} configs | mode=${allMode || idFilter.size ? 'all/both' : 'failing-only'} | concurrency=${CONCURRENCY}\n`);

  try {
    // Pass 1: axios (the current default) for every config.
    const axiosOutcomes = await pool(configs, CONCURRENCY, (c) => runWithBackend(c, 'axios'));
    const axiosById = new Map(axiosOutcomes.map((o) => [o.id, o]));

    // Pass 2 candidates: in failing-only mode, only the axios failures; else all.
    const runGotOn =
      allMode || idFilter.size > 0
        ? configs
        : configs.filter((c) => !axiosById.get(c.id)!.ok);

    const gotOutcomes = await pool(runGotOn, CONCURRENCY, (c) => runWithBackend(c, 'got-scraping'));
    const gotById = new Map(gotOutcomes.map((o) => [o.id, o]));

    const recovered: string[] = []; // axios fail -> got ok  (the headline signal)
    const regressed: string[] = []; // axios ok  -> got fail (only observable in all/both mode)
    const bothFail: string[] = [];
    const bothOk: string[] = [];

    for (const c of configs) {
      const a = axiosById.get(c.id)!;
      const g = gotById.get(c.id); // undefined in failing-only mode when axios already passed
      if (a.ok && !g) { bothOk.push(c.id); continue; } // not retried on got: axios already worked
      if (!a.ok && g?.ok) recovered.push(`${c.id}  (axios: ${a.reason || a.error || 'fail'} -> got: ${g.count} events)`);
      else if (a.ok && g && !g.ok) regressed.push(`${c.id}  (axios: ${a.count} events -> got: ${g.reason || g.error || 'fail'})`);
      else if (!a.ok && g && !g.ok) bothFail.push(`${c.id}  (${a.reason || a.error || 'fail'})`);
      else if (a.ok && g?.ok) bothOk.push(c.id);
    }

    const line = '─'.repeat(60);
    console.log(`\n${line}`);
    console.log(`RECOVERED by got-scraping (${recovered.length}):`);
    recovered.forEach((r) => console.log(`  + ${r}`));
    if (regressed.length) {
      console.log(`\nREGRESSED under got-scraping (${regressed.length}):`);
      regressed.forEach((r) => console.log(`  - ${r}`));
    }
    console.log(`\nStill failing on both (${bothFail.length}):`);
    bothFail.forEach((r) => console.log(`  · ${r}`));
    console.log(`\nWorking on axios (${bothOk.length}) — no change needed.`);
    console.log(line);
    console.log(
      `\nVerdict: got-scraping recovers ${recovered.length} of ${bothFail.length + recovered.length} axios failures` +
        (regressed.length ? `, but regresses ${regressed.length}.` : '.') +
        (recovered.length === 0
          ? ' No header-fingerprint benefit observed on this sample — do not roll out.'
          : ' Consider setting httpClient:"got-scraping" on the recovered configs.')
    );
  } finally {
    await closeBrowser(); // no-op here (playwright excluded), but keeps the process clean.
  }
}

main().catch((err) => {
  console.error('[compare] fatal:', err);
  process.exitCode = 1;
});
