import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { ScraperConfigSchema, isBlockedHost } from '../src/schemas/config.js';
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

test('isBlockedHost blocks private/loopback/metadata incl. encodings + mapped IPv6', () => {
  const blocked = [
    'localhost', '127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '::1',
    '::ffff:169.254.169.254', '::ffff:127.0.0.1', // IPv4-mapped IPv6
    '2130706433', // decimal for 127.0.0.1
    '0x7f000001', // hex for 127.0.0.1
    '0177.0.0.1'  // octal-leading form
  ];
  for (const h of blocked) assert.strictEqual(isBlockedHost(h), true, `${h} must be blocked`);

  const allowed = ['example.com', 'paradiso.nl', '8.8.8.8', '93.184.216.34'];
  for (const h of allowed) assert.strictEqual(isBlockedHost(h), false, `${h} must be allowed`);
});

test('config url rejects SSRF hosts (metadata / integer-encoded loopback)', () => {
  const base = {
    id: 'x', domain: 'x.com', type: 'static_selectors' as const,
    selectors: { eventBlock: '.e', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'US' }
  };
  assert.strictEqual(ScraperConfigSchema.safeParse({ ...base, url: 'http://169.254.169.254/latest/meta-data' }).success, false);
  assert.strictEqual(ScraperConfigSchema.safeParse({ ...base, url: 'http://2130706433/' }).success, false);
  assert.ok(ScraperConfigSchema.safeParse({ ...base, url: 'https://paradiso.nl/agenda' }).success);
});
