import test from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { ScraperConfigSchema, isBlockedHost } from '../src/schemas/config.js';
import { repairScraperConfig, testSelectorsOnHtml } from '../src/healing/repair.js';
import { safeAbsoluteUrl } from '../src/engine/url.js';
import { ConcertSchema } from '../src/schemas/concert.js';

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

test('published URL fields reject non-http schemes', () => {
  // Zod's bare .url() accepts all of these, and every one of these fields is
  // filled from LLM enrichment output or a scraped href, then published as a
  // clickable link in the static API.
  const base = {
    artist: 'The Cure', date: '2026-10-12', venue: 'Club Arena', city: 'Berlin',
    country: 'DE', originalSource: 'club-arena.de', scrapedAt: new Date().toISOString()
  };
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x', 'file:///etc/passwd']) {
    assert.strictEqual(ConcertSchema.safeParse({ ...base, ticketUrl: bad }).success, false, `ticketUrl ${bad}`);
    assert.strictEqual(ConcertSchema.safeParse({ ...base, artistWebsite: bad }).success, false, `artistWebsite ${bad}`);
    assert.strictEqual(
      ConcertSchema.safeParse({ ...base, artistSocials: { instagram: bad } }).success, false, `social ${bad}`
    );
  }
  // Real links and the empty-string sentinel still pass.
  assert.strictEqual(ConcertSchema.safeParse({ ...base, ticketUrl: 'https://a38.hu/x' }).success, true);
  assert.strictEqual(ConcertSchema.safeParse({ ...base, ticketUrl: '' }).success, true);
});

test('requestDelayMs is bounded — it reserves a slot in a shared per-domain map', () => {
  const base = {
    id: 'x', domain: 'example.com', url: 'https://example.com/', type: 'static_selectors',
    selectors: { eventBlock: '.e', date: '.d', venueNameFallback: 'V', cityNameFallback: 'C', countryNameFallback: 'DE' }
  };
  assert.strictEqual(ScraperConfigSchema.safeParse({ ...base, requestDelayMs: 999999999 }).success, false);
  assert.strictEqual(ScraperConfigSchema.safeParse({ ...base, requestDelayMs: 2000 }).success, true);
});

test('isBlockedHost covers CGNAT, reserved ranges and private name suffixes', () => {
  for (const bad of [
    '100.64.0.1', '100.127.255.254',      // CGNAT 100.64.0.0/10
    '198.18.0.1',                          // benchmark 198.18.0.0/15
    '192.0.2.1', '198.51.100.5', '203.0.113.9', // TEST-NET (documentation only)
    '239.1.1.1', '250.0.0.1',              // multicast / reserved
    'metadata.google.internal',            // named GCP credential endpoint
    'db.internal', 'nas.local', 'host.lan'
  ]) {
    assert.strictEqual(isBlockedHost(bad), true, `${bad} must be blocked`);
  }

  // Neighbours of those ranges are ordinary public space and must stay reachable.
  for (const good of [
    '8.8.8.8', '93.184.216.34', 'example.com', 'paradiso.nl', 'a38.hu',
    '100.128.0.1', '198.20.0.1', '192.1.2.3', '203.1.113.9', '223.255.255.1'
  ]) {
    assert.strictEqual(isBlockedHost(good), false, `${good} must be allowed`);
  }
});
