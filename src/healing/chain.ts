/**
 * Second-stage repair for a candidate URL that loaded but parsed to nothing.
 *
 * Relocating a scraper is rarely enough on its own. Sites that move their
 * schedule page usually redesign it at the same time, so the old selectors miss
 * on the new URL and the probe comes back `selectors_stale`. Measured live
 * against three real 404s from the 2026-07-24 fail-log (hanson.net,
 * hartfordsymphony.org, henrychocomedy.com), *every* reachable candidate landed
 * in exactly that state -- a URL-only strategy would have reported all three
 * unfixable while sitting on the correct page.
 *
 * So a reachable-but-unparseable candidate is treated as a find, not a failure:
 * client-rendered pages get the rendering scraper, everything else gets the LLM
 * re-selector run against the markup just fetched (fresher and more relevant
 * than the sample from the original, now-404 URL).
 */

import * as fs from 'fs/promises';
import { ScraperConfig, ScraperConfigSchema } from '../schemas/config.js';
import { VerifyReport } from './verify.js';

export interface ChainCandidate {
  config: ScraperConfig;
  htmlSample: string;
  /** The probe's failure reason: 'selectors_stale' or 'csr_detected'. */
  reason: string;
}

export interface ChainDeps {
  /** Rewrites the config at `configPath` in place from the given markup (healing/repair.ts). */
  repairConfig: (configPath: string, htmlSample: string) => Promise<{
    success: boolean;
    config?: ScraperConfig;
    error?: string;
  }>;
  /** Live verification gate. The caller wires circuit reset and baselines into this. */
  verify: (config: ScraperConfig) => Promise<VerifyReport>;
  /** False when no Gemini key is configured -- the render path still works without one. */
  hasLlmKey: boolean;
}

export interface ChainResult {
  config: ScraperConfig;
  report: VerifyReport;
  note: string;
}

export async function chainSelectorRepair(
  id: string,
  configPath: string,
  originalRaw: string,
  chain: ChainCandidate,
  deps: ChainDeps
): Promise<ChainResult | null> {
  if (chain.reason === 'csr_detected') {
    const rendered = ScraperConfigSchema.parse({ ...chain.config, type: 'playwright_render' });
    console.log(`[Healer] ${id}: ${chain.config.url} is client-rendered, retrying it with playwright_render.`);
    const report = await deps.verify(rendered);
    return report.ok
      ? { config: rendered, report, note: `relocated to ${rendered.url} and switched to playwright_render` }
      : null;
  }

  if (!deps.hasLlmKey) {
    console.warn(`[Healer] ${id}: reached ${chain.config.url} but no Gemini key is available to re-select on it.`);
    return null;
  }

  console.log(`[Healer] ${id}: ${chain.config.url} loads but the old selectors miss — re-selecting on the live markup.`);
  // repairConfig reads and rewrites the file in place, so the relocated URL has to
  // be on disk before it runs.
  await fs.writeFile(configPath, JSON.stringify(chain.config, null, 2) + '\n', 'utf-8');

  const res = await deps.repairConfig(configPath, chain.htmlSample);
  if (!res.success || !res.config) {
    await fs.writeFile(configPath, originalRaw, 'utf-8');
    return null;
  }

  const report = await deps.verify(res.config);
  if (report.ok) {
    return { config: res.config, report, note: `relocated to ${chain.config.url} and re-selected` };
  }

  // The gate refused it: the working tree must not keep a rejected repair.
  await fs.writeFile(configPath, originalRaw, 'utf-8');
  return null;
}
