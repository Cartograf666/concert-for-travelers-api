import test from 'node:test';
import assert from 'node:assert';
import { isBlockedResolvedAddress } from '../src/engine/runner.js';

// This file is deliberately run by test:ssrf-policy without
// SCRAPER_ALLOW_LOCAL_HOSTS. It covers the same predicate safeLookup uses after
// DNS resolution, rather than only schema validation of literal config URLs.
test('production connect-time SSRF policy permits public IPv6 and rejects non-public forms', {
  skip: process.env.SCRAPER_ALLOW_LOCAL_HOSTS === '1' ? 'run via npm run test:ssrf-policy (without the localhost escape hatch)' : false
}, () => {

  for (const address of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.strictEqual(isBlockedResolvedAddress(address), false, `${address} is public and must be reachable`);
  }

  for (const address of [
    '::1', 'fc00::1', 'fe90::1', 'fec0::1', 'ff02::1',
    '100::1', '100:0:0:1::1', '2001:db8::1', '3fff::1', '5f00::1', '4000::1',
    '::ffff:7f00:1', '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1', '64:ff9b:1::a9fe:a9fe', '64:ff9b:1::808:808',
    '2002:7f00:1::', '2002:808:808::'
  ]) {
    assert.strictEqual(isBlockedResolvedAddress(address), true, `${address} must remain blocked`);
  }
});
