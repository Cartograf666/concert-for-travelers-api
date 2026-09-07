import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { ScraperConfigSchema, isBlockedHost } from '../src/schemas/config.js';
import { repairScraperConfig, testSelectorsOnHtml } from '../src/healing/repair.js';
import { safeAbsoluteUrl } from '../src/engine/url.js';

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

test('ticketUrl drops dangerous schemes (javascript:/data:), keeps http(s)', () => {
  assert.strictEqual(safeAbsoluteUrl('javascript:alert(1)', 'https://x.com'), undefined);
  assert.strictEqual(safeAbsoluteUrl('data:text/html,x', 'https://x.com'), undefined);
  assert.strictEqual(safeAbsoluteUrl('/tickets/x', 'https://x.com'), 'https://x.com/tickets/x');

  const html = `<div class="e"><h3 class="a">The Cure</h3><span class="d">2026-10-12</span>` +
    `<a class="t" href="javascript:alert(1)">buy</a></div>`;
  const out = testSelectorsOnHtml(
    { eventBlock: '.e', artist: '.a', date: '.d', ticketUrl: '.t', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'US' },
    { id: 'x', domain: 'x.com', url: 'https://x.com', type: 'static_selectors' } as any,
    html
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ticketUrl, undefined, 'javascript: ticket href must be dropped');
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

test('isBlockedHost blocks the IPv6 spelling the URL parser actually produces', () => {
  // The dotted IPv4-mapped form this suite already checked ('::ffff:127.0.0.1')
  // never reaches isBlockedHost in practice: every caller parses the URL first,
  // and the WHATWG parser re-serializes it to hex.
  assert.strictEqual(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assert.strictEqual(new URL('http://[::ffff:169.254.169.254]/').hostname, '[::ffff:a9fe:a9fe]');

  // Those hex forms used to sail through the entire guard.
  for (const bad of [
    '::ffff:7f00:1',        // 127.0.0.1
    '::ffff:a9fe:a9fe',     // 169.254.169.254, cloud metadata
    '::ffff:0:7f00:1',      // 4-group mapped spelling
    '64:ff9b::7f00:1',      // NAT64 embedding 127.0.0.1
    '[::ffff:7f00:1]',      // still bracketed
  ]) {
    assert.strictEqual(isBlockedHost(bad), true, `${bad} must be blocked`);
  }
});

test('isBlockedHost still allows ordinary public hosts', () => {
  for (const good of ['example.com', 'paradiso.nl', '8.8.8.8', '93.184.216.34', 'a38.hu']) {
    assert.strictEqual(isBlockedHost(good), false, `${good} must be allowed`);
  }
});
