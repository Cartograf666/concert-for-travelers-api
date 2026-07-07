import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfigSchema } from '../schemas/config.js';
import { runScraper } from '../engine/runner.js';

(async () => {
  const id = process.argv[2];
  if (!id) { console.error('usage: test-config <venue-id>'); process.exit(1); }
  const file = path.join(process.cwd(), 'scrapers', `${id}.json`);
  const config = ScraperConfigSchema.parse(JSON.parse(await fs.readFile(file, 'utf-8')));
  const res = await runScraper(config);
  console.log(res.success ? `OK — ${res.concerts.length} events extracted` : `FAIL (${res.reason}): ${res.error}`);
  console.log(JSON.stringify(res.concerts.slice(0, 6), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
