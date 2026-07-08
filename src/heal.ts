import * as fs from 'fs/promises';
import * as path from 'path';
import { repairScraperConfig } from './healing/repair.js';
import { getGeminiKeys } from './engine/gemini_keys.js';

async function main() {
  const failLogPath = path.join(process.cwd(), 'reports', 'fail-log.json');
  const apiKeys = getGeminiKeys();

  console.log('[Healer] Starting Self-Healing process...');

  if (apiKeys.length === 0) {
    console.error('[Healer] Error: no Gemini API key set (GEMINI_API_KEY[/_2/_3]).');
    process.exit(1);
  }
  console.log(`[Healer] ${apiKeys.length} Gemini key(s) available for failover.`);

  try {
    // 1. Read fail log
    let fileContent = '';
    try {
      fileContent = await fs.readFile(failLogPath, 'utf-8');
    } catch {
      console.log('[Healer] No failure log found. Nothing to heal.');
      return;
    }

    const failures = JSON.parse(fileContent);
    if (!Array.isArray(failures) || failures.length === 0) {
      console.log('[Healer] No failed scrapers in log. Nothing to heal.');
      return;
    }

    console.log(`[Healer] Found ${failures.length} failed scrapers to repair.`);

    let healedCount = 0;
    const healedList: string[] = [];

    const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

    for (const failure of failures) {
      const { id, error, reason, htmlSample } = failure;
      console.log(`\n--- Healing ${id} ---`);
      console.log(`[Healer] Previous Error: ${error}`);

      // The fail-log is an untrusted CI artifact — validate the id and rebuild the config
      // path ourselves so a tampered entry can't aim the healer at a file outside scrapers/.
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        console.warn(`[Healer] Skip: invalid scraper id in fail-log: ${JSON.stringify(id)}`);
        continue;
      }
      const configPath = path.join(process.cwd(), 'scrapers', `${id}.json`);

      // Re-selecting can't fix a page whose events never reached the server HTML,
      // a network failure, or a domain that's actively blocking us. Skip these so
      // we don't waste Gemini calls / risk overwriting a correct config with
      // selectors guessed from an empty shell.
      if (reason === 'csr_detected' || reason === 'fetch_error' || reason === 'circuit_open') {
        console.warn(`[Healer] Skip: ${id} failed with reason "${reason}" — not fixable by re-selecting (needs a render/JSON path).`);
        continue;
      }

      if (!htmlSample) {
        console.warn(`[Healer] Skip: No HTML sample captured for scraper: ${id}`);
        continue;
      }

      const res = await repairScraperConfig(configPath, htmlSample, apiKeys);
      if (res.success && res.config) {
        console.log(`[Healer] Successfully healed scraper config: ${id}`);
        healedCount++;
        healedList.push(id);
      } else {
        console.warn(`[Healer] Failed to heal scraper config ${id}: ${res.error}`);
      }
    }

    console.log('\n======================================');
    console.log(`[Healer] Self-healing complete. Healed ${healedCount}/${failures.length} scrapers.`);
    if (healedCount > 0) {
      console.log(`[Healer] Repaired: ${healedList.join(', ')}`);
      // Create a sentinel file to notify GitHub Actions that repairs occurred
      const repairSummaryPath = path.join(process.cwd(), 'reports', 'repair-summary.json');
      await fs.writeFile(
        repairSummaryPath,
        JSON.stringify({ healed: healedList }, null, 2),
        'utf-8'
      );
    }
    console.log('======================================');

  } catch (error: any) {
    console.error(`[Healer] Critical error during healing run: ${error.message}`);
    process.exit(1);
  }
}

main();
