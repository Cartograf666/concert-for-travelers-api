import * as fs from 'fs/promises';
import * as path from 'path';
import { repairScraperConfig } from './healing/repair.js';

async function main() {
  const failLogPath = path.join(process.cwd(), 'reports', 'fail-log.json');
  const apiKey = process.env.GEMINI_API_KEY;

  console.log('[Healer] Starting Self-Healing process...');

  if (!apiKey) {
    console.error('[Healer] Error: GEMINI_API_KEY environment variable is not set.');
    process.exit(1);
  }

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

    for (const failure of failures) {
      const { id, configPath, error, htmlSample } = failure;
      console.log(`\n--- Healing ${id} ---`);
      console.log(`[Healer] Previous Error: ${error}`);

      if (!htmlSample) {
        console.warn(`[Healer] Skip: No HTML sample captured for scraper: ${id}`);
        continue;
      }

      const res = await repairScraperConfig(configPath, htmlSample, apiKey);
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
