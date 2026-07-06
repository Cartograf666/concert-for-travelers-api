import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfigs, runAllScrapers, ScraperResult } from './engine/runner.js';
import { processConcerts } from './pipeline/process.js';
import { publishConcerts } from './generator/publish.js';

async function main() {
  const scrapersDir = path.join(process.cwd(), 'scrapers');
  const distDir = path.join(process.cwd(), 'dist');
  const reportsDir = path.join(process.cwd(), 'reports');
  const approvedArtistsPath = path.join(process.cwd(), 'data', 'approved_artists.json');

  console.log('[Orchestrator] Starting Daily Concert Scrape...');

  try {
    // 1. Ensure scrapers folder exists
    await fs.mkdir(scrapersDir, { recursive: true });

    // 2. Load configurations
    const configs = await loadConfigs(scrapersDir);
    if (configs.length === 0) {
      console.log('[Orchestrator] No scrapers found in scrapers/. Exiting.');
      // Create empty index.json in dist to avoid client fetch crashes
      await publishConcerts([], distDir);
      return;
    }

    console.log(`[Orchestrator] Loaded ${configs.length} scraper configurations.`);

    // 3. Run scrapers concurrently
    const results = await runAllScrapers(configs);

    // 4. Gather scraped concerts
    const allScrapedConcerts = results.flatMap((r) => r.concerts);
    console.log(`[Orchestrator] Gathered ${allScrapedConcerts.length} raw events before processing.`);

    // 5. Normalize and deduplicate
    const normalizedConcerts = await processConcerts(allScrapedConcerts, approvedArtistsPath);
    console.log(`[Orchestrator] Cleaned and normalized into ${normalizedConcerts.length} valid events.`);

    // 6. Write static API files to dist/
    await publishConcerts(normalizedConcerts, distDir);

    // 7. Process failures & save to reports/fail-log.json for self-healing
    await fs.mkdir(reportsDir, { recursive: true });
    
    const failures = results
      .filter((r) => !r.success)
      .map((r) => ({
        id: r.configId,
        configPath: path.join(scrapersDir, `${r.configId}.json`),
        error: r.error,
        htmlSample: r.htmlSample
      }));

    const failLogPath = path.join(reportsDir, 'fail-log.json');
    await fs.writeFile(
      failLogPath,
      JSON.stringify(failures, null, 2),
      'utf-8'
    );

    console.log(`[Orchestrator] Scrape complete. Successful scrapers: ${configs.length - failures.length}/${configs.length}.`);
    console.log(`[Orchestrator] Failed scrapers log saved to: ${failLogPath}`);

  } catch (error: any) {
    console.error(`[Orchestrator] Critical error during scrape run: ${error.message}`);
    process.exit(1);
  }
}

main();
