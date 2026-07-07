import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfigSchema } from '../schemas/config.js';
import { runScraper } from '../engine/runner.js';

async function resolveConfigPath(id: string): Promise<string> {
  // Venue configs live flat under scrapers/; artist tour-page configs live one
  // level down under scrapers/artists/ (kept separate so they can run on their
  // own, less-frequent schedule -- see docs/GEMINI-TASKS.md Task C). Same `id`
  // convention either way, so check both rather than making the caller specify.
  const top = path.join(process.cwd(), 'scrapers', `${id}.json`);
  try {
    await fs.access(top);
    return top;
  } catch {
    return path.join(process.cwd(), 'scrapers', 'artists', `${id}.json`);
  }
}

(async () => {
  const id = process.argv[2];
  if (!id) { console.error('usage: test-config <venue-id>'); process.exit(1); }
  const file = await resolveConfigPath(id);
  const config = ScraperConfigSchema.parse(JSON.parse(await fs.readFile(file, 'utf-8')));
  const res = await runScraper(config);
  console.log(res.success ? `OK — ${res.concerts.length} events extracted` : `FAIL (${res.reason}): ${res.error}`);
  console.log(JSON.stringify(res.concerts.slice(0, 6), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
