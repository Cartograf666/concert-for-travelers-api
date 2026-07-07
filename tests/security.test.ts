import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { repairScraperConfig } from '../src/healing/repair.js';

const BASE = {
  domain: 'x.com',
  url: 'https://x.com/agenda',
  type: 'static_selectors' as const,
  selectors: { eventBlock: '.e', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'US' }
};

test('config `id` enforces a safe charset (blocks path traversal / module injection)', () => {
  assert.ok(ScraperConfigSchema.safeParse({ ...BASE, id: 'paradiso-amsterdam' }).success, 'normal id accepted');
  assert.ok(ScraperConfigSchema.safeParse({ ...BASE, id: 'the-o2-arena-london' }).success);

  for (const bad of ['../../evil', 'a/b', 'a.b', '../x', 'UPPER', 'a b', '', '-lead', 'sla/../sh', '../../.github/workflows/daily-scrape']) {
    assert.strictEqual(
      ScraperConfigSchema.safeParse({ ...BASE, id: bad }).success,
      false,
      `id "${bad}" must be rejected`
    );
  }
});

test('repairScraperConfig refuses a config path outside scrapers/', async () => {
  const escaping = path.join(process.cwd(), '..', '..', 'etc', 'passwd');
  const res = await repairScraperConfig(escaping, '<html></html>', 'fake-key');
  assert.strictEqual(res.success, false);
  assert.match(res.error || '', /outside scrapers\//);
});
