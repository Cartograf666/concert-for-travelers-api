import test from 'node:test';
import assert from 'node:assert';
import { classifyFailure, extractHttpStatus } from '../src/healing/classify.js';

test('classify - HTTP status extraction', () => {
  assert.strictEqual(extractHttpStatus('Request failed with status code 404'), 404);
  assert.strictEqual(extractHttpStatus('Request failed with status code 503'), 503);
  assert.strictEqual(extractHttpStatus('getaddrinfo ENOTFOUND example.com'), null);
  assert.strictEqual(extractHttpStatus(undefined), null);
});

test('classify - dead domains vs temporary resolver failures', () => {
  // NXDOMAIN: the name is gone, retire it.
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'getaddrinfo ENOTFOUND www.paigehaley.com' }).strategy,
    'dead_domain'
  );
  // A domain re-parked on loopback trips the SSRF guard -- also dead.
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'Blocked SSRF target: www.hallandoates.com -> 127.0.0.1' }).strategy,
    'dead_domain'
  );
  // EAI_AGAIN is the runner's resolver being busy, NOT a dead domain. Retiring on
  // this would delete live scrapers over CI flakiness.
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'getaddrinfo EAI_AGAIN example.com' }).strategy,
    'transient'
  );
});

test('classify - HTTP status drives the strategy', () => {
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 404' }).strategy,
    'url_moved'
  );
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 403' }).strategy,
    'anti_bot'
  );
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 500' }).strategy,
    'transient'
  );
  // 429 is rate limiting, not a header-fingerprint block -- back off, don't swap backend.
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 429' }).strategy,
    'transient'
  );
});

test('classify - TLS failures are their own strategy', () => {
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'certificate has expired' }).strategy,
    'tls_broken'
  );
  assert.strictEqual(
    classifyFailure({
      reason: 'fetch_error',
      error: "Hostname/IP does not match certificate's altnames: Host: philadelphiafreedomband.com. is not in the cert's altnames: DNS:*.squarespace.com"
    }).strategy,
    'tls_broken'
  );
});

test('classify - timeouts are transient', () => {
  assert.strictEqual(
    classifyFailure({ reason: 'fetch_error', error: 'timeout of 15000ms exceeded' }).strategy,
    'transient'
  );
  assert.strictEqual(
    classifyFailure({ reason: 'circuit_open', error: 'Circuit breaker open for domain x.com' }).strategy,
    'transient'
  );
});

test('classify - selector strategies require a captured sample', () => {
  assert.strictEqual(
    classifyFailure({ reason: 'selectors_stale', error: 'Parsed 0 concerts.', htmlSample: '<html></html>' }).strategy,
    'selectors'
  );
  assert.strictEqual(
    classifyFailure({ reason: 'parse_error', error: 'Response data is not a string.', htmlSample: '{"a":1}' }).strategy,
    'selectors'
  );
  // Without a sample there is nothing to re-select against.
  assert.strictEqual(
    classifyFailure({ reason: 'parse_error', error: 'Response data is not a string.' }).strategy,
    'unfixable'
  );
});

test('classify - client-side rendering routes to the render strategy', () => {
  assert.strictEqual(
    classifyFailure({
      reason: 'csr_detected',
      error: 'Parsed 0 concerts. Page appears client-side rendered.',
      htmlSample: '<div id="root"></div>'
    }).strategy,
    'needs_render'
  );
});

test('classify - unknown fetch errors stay transient rather than dead', () => {
  const c = classifyFailure({ reason: 'fetch_error', error: 'something nobody has seen before' });
  assert.strictEqual(c.strategy, 'transient');
  assert.match(c.detail, /unclassified/);
});
