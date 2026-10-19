/** Offline native extraction evidence with the real artistDb read path. No writes to artist DB. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const axios = require('axios');
const net = require('node:net');
const dns = require('node:dns');
import { runScraper } from '../../../src/engine/runner.ts';
import { ScraperConfigSchema } from '../../../src/schemas/config.ts';
import { processConcerts } from '../../../src/pipeline/process.ts';
const input = process.argv[2];
assert.ok(input, 'Pass the native evidence inputs.json');
const inputs = JSON.parse(fs.readFileSync(input));
const dir = path.dirname(input);
mock.timers.enable({ apis: ['Date'], now: Date.parse(inputs.clock) });
const source = inputs.sources[0];
const reads = [];
// Match the publisher harness's CJS transport instance and forbid accidental live I/O.
process.env.SCRAPER_HTTP_BACKEND = 'axios';
const forbidden = () => { throw new Error('Offline replay forbids socket/DNS'); };
mock.method(net.Socket.prototype, 'connect', forbidden);
mock.method(dns, 'lookup', forbidden);
mock.method(dns.promises, 'lookup', forbidden);
syncBuiltinESMExports();
mock.method(axios, 'get', async url => {
  const response = source.responses.find(r => r.url === url);
  assert.ok(response, `Missing captured GET: ${url}`);
  const bytes = fs.readFileSync(path.join(dir, response.body));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), response.sha256);
  reads.push({ url, sha256: response.sha256, capturedAt: response.capturedAt });
  return { status: response.status, data: bytes.toString('utf8'), headers: response.headers ?? {} };
});
mock.method(globalThis, 'fetch', async () => { throw new Error('Offline native replay: no unrecorded fetch'); });
try {
  const config = ScraperConfigSchema.parse(JSON.parse(fs.readFileSync(source.configPath)));
  const raw = await runScraper(config);
  assert.equal(raw.success, true, raw.error);
  assert.deepEqual(reads.map(r => r.url), [config.url]);
  let approvedCount = 0;
  let diagnostics;
  const normalized = await processConcerts(raw.concerts, 'data/artists', inputs.clock,
    artists => { approvedCount = artists.length; }, report => { diagnostics = report; });
  assert.equal(normalized.length, raw.concerts.length, 'Native official rows must survive actual artistDb path');
  fs.writeFileSync(path.join(dir, source.savedRaw), JSON.stringify(raw, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'ddt-native-process.json'), JSON.stringify({ clock: inputs.clock,
    configPath: source.configPath, reads, artistDb: 'data/artists via processConcerts -> loadApprovedArtists',
    approvedCount, rawCount: raw.concerts.length, normalized, diagnostics }, null, 2) + '\n');
  console.log(JSON.stringify({ success: true, reads, rawCount: raw.concerts.length, normalizedCount: normalized.length, approvedCount }));
} finally { mock.restoreAll(); mock.timers.reset(); }
