import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

async function withHtml(html: string, run: (url: string) => Promise<void>) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}/events`); }
  finally { server.close(); await once(server, 'close'); }
}

function config(url: string, allowEmpty = false): ScraperConfig {
  return { id: 'source-challenge-proof', domain: '127.0.0.1', url, type: 'jsonld', maxRetries: 0,
    allowEmpty, selectors: { eventBlock: '.event', date: '.date', artistNameFallback: 'Test Artist',
      venue: '.venue', city: '.city', countryNameFallback: 'US' } };
}

test('captured HTTP-200 SGCaptcha pages fail as access errors even when empty schedules are allowed', async () => {
  const captures = JSON.parse(await readFile('tests/fixtures/sgcaptcha-source-responses-20261007.json', 'utf8')) as
    { id: string; htmlSample: string }[];
  assert.equal(captures.length, 2);
  for (const capture of captures) {
    await withHtml(capture.htmlSample, async url => {
      for (const allowEmpty of [false, true]) {
        const result = await runScraper(config(url, allowEmpty));
        assert.equal(result.success, false, capture.id);
        assert.equal(result.reason, 'fetch_error', capture.id);
        assert.match(result.error || '', /source access.*SGCaptcha/i);
        assert.deepEqual(result.concerts, []);
        assert.equal(result.htmlSample, capture.htmlSample);
      }
    });
  }
});

test('ordinary source content mentioning captcha and unrelated refresh URLs is not blocked', async () => {
  const body = '<article class="event"><span class="date">2027-01-02</span><span class="venue">Verified Hall</span>' +
    '<span class="city">Boston</span></article><p>Help: /.well-known/sgcaptcha/</p>';
  for (const html of [body, '<meta http-equiv="refresh" content="0;/new-calendar">' + body]) {
    await withHtml(html, async url => {
      const result = await runScraper({ ...config(url), type: 'static_selectors' });
      assert.equal(result.success, true);
      assert.equal(result.concerts.length, 1);
      assert.equal(result.concerts[0].venue, 'Verified Hall');
    });
  }
});
