import test from 'node:test';
import assert from 'node:assert';
import {
  buildConcertsFromExtraction,
  tryLlmExtractionFallback,
  resetLlmFallbackBudget,
  getLlmFallbackBudgetRemaining,
  getLlmFallbackUsageSummary
} from '../src/engine/llm_extraction_fallback.js';
import { ScraperConfig } from '../src/schemas/config.js';

function config(overrides: Partial<ScraperConfig> = {}): ScraperConfig {
  return {
    id: 'test-venue',
    domain: 'test-venue.example',
    url: 'https://test-venue.example/shows',
    type: 'static_selectors',
    selectors: {
      eventBlock: '.event',
      date: '.date',
      venueNameFallback: 'The Test Room',
      cityNameFallback: 'Testville',
      countryNameFallback: 'US'
    },
    ...overrides
  } as ScraperConfig;
}

test('buildConcertsFromExtraction: fills venue/city/country from config fallbacks when the LLM omits them', () => {
  const result = { concerts: [{ date: '12 Oct 2026', artist: 'The Testers' }] };
  const concerts = buildConcertsFromExtraction(config(), result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts.length, 1);
  assert.strictEqual(concerts[0].artist, 'The Testers');
  assert.strictEqual(concerts[0].venue, 'The Test Room');
  assert.strictEqual(concerts[0].city, 'Testville');
  assert.strictEqual(concerts[0].country, 'US');
});

test('buildConcertsFromExtraction: prefers LLM-provided fields over config fallbacks when both are present', () => {
  const result = { concerts: [{ date: '12 Oct 2026', artist: 'X', venue: 'Real Venue From Page', city: 'Real City', country: 'DE' }] };
  const concerts = buildConcertsFromExtraction(config(), result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts[0].venue, 'Real Venue From Page');
  assert.strictEqual(concerts[0].city, 'Real City');
  assert.strictEqual(concerts[0].country, 'DE');
});

test('buildConcertsFromExtraction: an artist-tour-page scraper falls back to artistNameFallback when the LLM omits artist', () => {
  const cfg = config({ selectors: { eventBlock: '.event', date: '.date', artistNameFallback: 'Solo Artist', venueNameFallback: '', cityNameFallback: '', countryNameFallback: 'GB' } as any });
  const result = { concerts: [{ date: '1 Jan 2027', venue: 'Some Hall', city: 'Some City' }] };
  const concerts = buildConcertsFromExtraction(cfg, result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts[0].artist, 'Solo Artist');
});

test('buildConcertsFromExtraction: drops an entry missing both artist and any fallback, or missing a date', () => {
  const cfg = config({ selectors: { eventBlock: '.event', date: '.date', venueNameFallback: '', cityNameFallback: '', countryNameFallback: 'US' } as any }); // no artistNameFallback
  const result = {
    concerts: [
      { date: '1 Jan 2027' }, // no artist anywhere -- dropped
      { date: '', artist: 'Has Artist But No Date' }, // no date -- dropped
      { date: '2 Jan 2027', artist: 'Valid One' }
    ]
  };
  const concerts = buildConcertsFromExtraction(cfg, result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts.length, 1);
  assert.strictEqual(concerts[0].artist, 'Valid One');
});

test('buildConcertsFromExtraction: rejects a dangerous-scheme ticketUrl instead of publishing it verbatim', () => {
  const result = { concerts: [{ date: '12 Oct 2026', artist: 'X', ticketUrl: 'javascript:alert(1)' }] };
  const concerts = buildConcertsFromExtraction(config(), result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts[0].ticketUrl, undefined);
});

test('buildConcertsFromExtraction: resolves a real relative/absolute http(s) ticketUrl via safeAbsoluteUrl', () => {
  const result = { concerts: [{ date: '12 Oct 2026', artist: 'X', ticketUrl: '/tickets/123' }] };
  const concerts = buildConcertsFromExtraction(config(), result, '2026-07-01T00:00:00.000Z');
  assert.strictEqual(concerts[0].ticketUrl, 'https://test-venue.example/tickets/123');
});

test('buildConcertsFromExtraction: empty concerts array in, empty array out', () => {
  const concerts = buildConcertsFromExtraction(config(), { concerts: [] }, '2026-07-01T00:00:00.000Z');
  assert.deepStrictEqual(concerts, []);
});

test('tryLlmExtractionFallback: returns [] without throwing when no Gemini key is configured', async () => {
  const originalEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GEMINI_API_KEY')) delete process.env[key];
  }
  try {
    const concerts = await tryLlmExtractionFallback(config(), '<html>irrelevant</html>', '2026-07-01T00:00:00.000Z');
    assert.deepStrictEqual(concerts, []);
  } finally {
    process.env = originalEnv;
  }
});

test('tryLlmExtractionFallback: returns [] without throwing (and without consuming budget) once the per-run budget is exhausted', async () => {
  resetLlmFallbackBudget(0);
  try {
    const concerts = await tryLlmExtractionFallback(config(), '<html>irrelevant</html>', '2026-07-01T00:00:00.000Z');
    assert.deepStrictEqual(concerts, []);
    assert.strictEqual(getLlmFallbackBudgetRemaining(), 0); // untouched -- never attempted a call
  } finally {
    resetLlmFallbackBudget(); // restore the default for any other test relying on it
  }
});

test('resetLlmFallbackBudget/getLlmFallbackBudgetRemaining: round-trips a custom budget value', () => {
  resetLlmFallbackBudget(7);
  assert.strictEqual(getLlmFallbackBudgetRemaining(), 7);
  resetLlmFallbackBudget();
  assert.strictEqual(getLlmFallbackBudgetRemaining(), 30);
});

test('tryLlmExtractionFallback: budget check-then-decrement is a single synchronous step, so concurrent calls never overshoot the cap', async () => {
  // No key configured -- each call still must decrement (synchronously) before
  // it later discovers there's no key and bails, so this exercises the same
  // check-then-decrement path a real run hits, with zero network calls.
  const originalEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GEMINI_API_KEY')) delete process.env[key];
  }
  resetLlmFallbackBudget(2);
  try {
    await Promise.all(
      Array.from({ length: 5 }, () => tryLlmExtractionFallback(config(), '<html>irrelevant</html>', '2026-07-01T00:00:00.000Z'))
    );
    // Only the first 2 of the 5 concurrent calls should have consumed budget --
    // before the fix, an `await` between the check and the decrement let all 5
    // slip past the gate and drive this negative.
    assert.strictEqual(getLlmFallbackBudgetRemaining(), 0);
  } finally {
    process.env = originalEnv;
    resetLlmFallbackBudget();
  }
});

test('getLlmFallbackUsageSummary: reports calls used out of the default budget', () => {
  resetLlmFallbackBudget(30);
  resetLlmFallbackBudget(30 - 3);
  assert.strictEqual(getLlmFallbackUsageSummary(), 'LLM fallback usage: 3/30 calls used this run.');
  resetLlmFallbackBudget();
});
