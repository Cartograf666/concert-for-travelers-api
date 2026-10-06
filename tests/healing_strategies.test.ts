import test from 'node:test';
import assert from 'node:assert';
import {
  proposeRepairCandidates, rankTourUrlCandidates, isSameSite, swapWwwVariant, MAX_CANDIDATES
} from '../src/healing/strategies.js';
import { classifyFailure } from '../src/healing/classify.js';
import { ScraperConfig } from '../src/schemas/config.js';

const base: ScraperConfig = {
  id: 'artist-example',
  domain: 'example.com',
  url: 'https://example.com/tour-dates',
  type: 'static_selectors',
  selectors: {
    eventBlock: '.event',
    artist: '.artist',
    date: '.date',
    venueNameFallback: '',
    cityNameFallback: '',
    countryNameFallback: 'US'
  }
};

const deps = (over: Partial<{ resolves: boolean; html: string }> = {}) => ({
  hostResolves: async () => over.resolves ?? true,
  fetchHtml: async () => over.html ?? '<html></html>'
});

test('strategies - same-site check rejects lookalike domains', () => {
  assert.strictEqual(isSameSite('https://example.com/a', 'https://example.com/tour'), true);
  assert.strictEqual(isSameSite('https://example.com/a', 'https://www.example.com/tour'), true);
  // Suffix matching would accept this; it must not.
  assert.strictEqual(isSameSite('https://example.com/a', 'https://evil-example.com/tour'), false);
  assert.strictEqual(isSameSite('https://example.com/a', 'https://example.com.evil.net/tour'), false);
  // Rediscovery reads links out of attacker-controlled HTML -- non-http and
  // private hosts must never become a committed config URL.
  assert.strictEqual(isSameSite('https://example.com/a', 'javascript:alert(1)'), false);
  assert.strictEqual(isSameSite('http://127.0.0.1/a', 'http://127.0.0.1/tour'), false);
});

test('strategies - ranks schedule-looking links above the rest', () => {
  const html = `
    <a href="/about">About us</a>
    <a href="/blog/2019/our-tour-diary">Tour diary</a>
    <a href="/tour">Tour Dates</a>
    <a href="/shop">Shop</a>
    <a href="https://facebook.com/band">Follow us</a>
  `;
  const ranked = rankTourUrlCandidates(html, 'https://example.com/tour-dates');
  assert.strictEqual(ranked[0], 'https://example.com/tour');
  // Off-site links are dropped entirely.
  assert.ok(!ranked.some((u) => u.includes('facebook.com')));
  // Shallow paths outrank deep ones even when both mention "tour".
  assert.ok(ranked.indexOf('https://example.com/tour') < ranked.indexOf('https://example.com/blog/2019/our-tour-diary'));
});

test('strategies - rediscovery excludes the URL that already 404d', () => {
  const html = '<a href="/tour-dates">Tour Dates</a><a href="/shows">Shows</a>';
  const ranked = rankTourUrlCandidates(html, 'https://example.com/tour-dates', 'https://example.com/tour-dates');
  assert.ok(!ranked.includes('https://example.com/tour-dates'));
  assert.ok(ranked.includes('https://example.com/shows'));
});

test('strategies - url_moved proposes capped, schema-valid candidates', async () => {
  const html = '<a href="/shows">Shows</a><a href="/calendar">Calendar</a>';
  const plan = await proposeRepairCandidates(
    base,
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 404' }),
    deps({ html })
  );
  assert.strictEqual(plan.retire, false);
  assert.ok(plan.candidates.length > 0);
  assert.ok(plan.candidates.length <= MAX_CANDIDATES);
  assert.strictEqual(plan.candidates[0].url, 'https://example.com/shows');
  // Everything else about the config is carried over untouched.
  assert.strictEqual(plan.candidates[0].selectors?.eventBlock, '.event');
});

test('strategies - url_moved still guesses common paths when the root is unreachable', async () => {
  const plan = await proposeRepairCandidates(
    base,
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 404' }),
    { hostResolves: async () => true, fetchHtml: async () => { throw new Error('root also 404'); } }
  );
  assert.ok(plan.candidates.length > 0);
  assert.ok(plan.candidates.some((c) => c.url === 'https://example.com/tour'));
});

test('strategies - dead domain retires only when DNS confirms it', async () => {
  const classification = classifyFailure({ reason: 'fetch_error', error: 'getaddrinfo ENOTFOUND example.com' });

  const dead = await proposeRepairCandidates(base, classification, deps({ resolves: false }));
  assert.strictEqual(dead.retire, true);
  assert.strictEqual(dead.candidates.length, 0);

  // The fail-log said NXDOMAIN but the name resolves now -- do not delete a live site.
  const alive = await proposeRepairCandidates(base, classification, deps({ resolves: true }));
  assert.strictEqual(alive.retire, false);
  assert.strictEqual(alive.candidates.length, 1);
  assert.strictEqual(alive.candidates[0].maxRetries, 4);

  const polite = await proposeRepairCandidates(
    { ...base, requestDelayMs: 2000 }, classification, deps({ resolves: true }));
  assert.strictEqual(polite.candidates[0].maxRetries, 3);
  assert.strictEqual(polite.candidates[0].requestDelayMs, 2000);
  const tooSlow = await proposeRepairCandidates(
    { ...base, requestDelayMs: 30000 }, classification, deps({ resolves: true }));
  assert.strictEqual(tooSlow.retire, false);
  assert.strictEqual(tooSlow.candidates.length, 0);
});

test('strategies - anti_bot escalates to the got-scraping backend', async () => {
  const plan = await proposeRepairCandidates(
    base,
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 403' }),
    deps()
  );
  assert.strictEqual(plan.candidates[0].httpClient, 'got-scraping');
  assert.strictEqual(plan.candidates[1].requestDelayMs, 3000);

  // An inherited five-retry config must be bounded before the backend probe.
  // At 8s politeness, only the default two retries fit; no duplicate probe.
  const slow = await proposeRepairCandidates(
    { ...base, maxRetries: 5, requestDelayMs: 8000 },
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 403' }), deps());
  assert.strictEqual(slow.candidates.length, 1);
  assert.strictEqual(slow.candidates[0].httpClient, 'got-scraping');
  assert.strictEqual(slow.candidates[0].maxRetries, 2);
  assert.strictEqual(slow.candidates[0].requestDelayMs, 8000);
  const tooSlow = await proposeRepairCandidates(
    { ...base, requestDelayMs: 30000 },
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 403' }), deps());
  assert.strictEqual(tooSlow.candidates.length, 0);
  assert.strictEqual(tooSlow.retire, false);

  // Already escalated: nothing further to try, and it must not loop.
  const already = await proposeRepairCandidates(
    { ...base, httpClient: 'got-scraping' },
    classifyFailure({ reason: 'fetch_error', error: 'Request failed with status code 403' }),
    deps()
  );
  assert.strictEqual(already.candidates.length, 0);
});

test('strategies - transient candidates fit the scraper wall clock and preserve politeness', async () => {
  const classification = classifyFailure({ reason: 'fetch_error', error: 'timeout of 15000ms exceeded' });

  const plan = await proposeRepairCandidates(base, classification, deps());
  assert.strictEqual(plan.candidates.length, 1);
  assert.strictEqual(plan.candidates[0].maxRetries, 3);
  assert.strictEqual(plan.candidates[0].requestDelayMs, 2000);
  assert.strictEqual(plan.candidates[0].url, base.url);

  // A previous healer could persist five retries: six 15s requests already
  // exhaust the 90s runner ceiling before backoff. Correct that config too.
  const overBudget = await proposeRepairCandidates(
    { ...base, maxRetries: 5, requestDelayMs: 2000 }, classification, deps());
  assert.strictEqual(overBudget.candidates[0].maxRetries, 3);
  assert.strictEqual(overBudget.candidates[0].requestDelayMs, 2000);

  // More politeness can leave room for only the default retry count, or none.
  const slower = await proposeRepairCandidates(
    { ...base, maxRetries: 5, requestDelayMs: 8000 }, classification, deps());
  assert.strictEqual(slower.candidates[0].maxRetries, 2);
  assert.strictEqual(slower.candidates[0].requestDelayMs, 8000);
  const tooSlow = await proposeRepairCandidates(
    { ...base, requestDelayMs: 30000 }, classification, deps());
  assert.strictEqual(tooSlow.candidates.length, 0);

  const alreadySafe = await proposeRepairCandidates(
    { ...base, maxRetries: 3, requestDelayMs: 2000 }, classification, deps());
  assert.strictEqual(alreadySafe.candidates.length, 0);
});

test('strategies - csr switches the scraper to rendering', async () => {
  const plan = await proposeRepairCandidates(
    base,
    classifyFailure({ reason: 'csr_detected', error: 'client-side rendered', htmlSample: '<div id="root"></div>' }),
    deps()
  );
  assert.strictEqual(plan.candidates[0].type, 'playwright_render');
});

test('strategies - tls_broken tries the www/apex variant, retires when the host is gone', async () => {
  assert.strictEqual(swapWwwVariant('https://example.com/tour'), 'https://www.example.com/tour');
  assert.strictEqual(swapWwwVariant('https://www.example.com/tour'), 'https://example.com/tour');

  const classification = classifyFailure({ reason: 'fetch_error', error: 'certificate has expired' });

  const alive = await proposeRepairCandidates(base, classification, deps({ resolves: true }));
  assert.strictEqual(alive.retire, false);
  assert.strictEqual(alive.candidates[0].url, 'https://www.example.com/tour-dates');

  const gone = await proposeRepairCandidates(base, classification, deps({ resolves: false }));
  assert.strictEqual(gone.retire, true);
});

test('strategies - selector repairs are left to the LLM path', async () => {
  const plan = await proposeRepairCandidates(
    base,
    classifyFailure({ reason: 'selectors_stale', error: 'Parsed 0 concerts.', htmlSample: '<html></html>' }),
    deps()
  );
  assert.strictEqual(plan.candidates.length, 0);
  assert.strictEqual(plan.retire, false);
});
