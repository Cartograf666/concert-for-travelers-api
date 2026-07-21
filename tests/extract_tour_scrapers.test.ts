import test from 'node:test';
import assert from 'node:assert';
import {
  buildScraperConfig,
  fetchTourHtml,
  selectTourScraperCandidates,
  validateStaticSelectorsAgainstHtml
} from '../src/scripts/extract_tour_scrapers.js';

const originalFetch = global.fetch;

test('extract_tour_scrapers - selects only professional or legacy untiered tourUrl rows without existing configs', () => {
  const artists: any[] = [
    { name: 'Professional', tier: 'professional', tourUrl: 'https://pro.example/tour' },
    { name: 'Longtail', tier: 'longtail', tourUrl: 'https://long.example/tour' },
    { name: 'Legacy', tourUrl: 'https://legacy.example/tour' },
    { name: 'Tried', tier: 'professional', tourUrl: 'https://tried.example/tour', tourScraperTriedAt: '2026-07-09T00:00:00.000Z' },
    { name: 'Covered', tier: 'professional', tourUrl: 'https://covered.example/tour' }
  ];

  const selected = selectTourScraperCandidates(artists, new Set(['covered']), 10);
  assert.deepStrictEqual(selected.map((artist) => artist.name), ['Professional', 'Legacy']);
});

test('extract_tour_scrapers - builds and validates a static artist scraper config', () => {
  const config = buildScraperConfig('Test Artist', 'https://artist.example/tour', {
    selectors: {
      eventBlock: '.show',
      date: '.date',
      city: '.city',
      venue: '.venue',
      ticketUrl: 'a.ticket',
      venueNameFallback: '',
      cityNameFallback: '',
      countryNameFallback: 'GB'
    }
  });

  assert.ok(config);
  assert.strictEqual(config.id, 'artist-test-artist');
  assert.strictEqual(config.domain, 'artist.example');
  assert.strictEqual(config.url, 'https://artist.example/tour');
  assert.strictEqual(config.selectors?.artistNameFallback, 'Test Artist');
});

test('extract_tour_scrapers - generated config cannot hijack code-owned fields', () => {
  const config = buildScraperConfig('Safe Artist', 'https://artist.example/tour', {
    id: 'attacker-id',
    domain: 'attacker.example',
    url: 'https://attacker.example/scrape',
    type: 'custom_js',
    selectors: {
      artistNameFallback: 'Injected Artist',
      eventBlock: '.show',
      date: '.date',
      venueNameFallback: '',
      cityNameFallback: '',
      countryNameFallback: 'GB'
    }
  });

  assert.ok(config);
  assert.strictEqual(config.id, 'artist-safe-artist');
  assert.strictEqual(config.domain, 'artist.example');
  assert.strictEqual(config.url, 'https://artist.example/tour');
  assert.strictEqual(config.type, 'static_selectors');
  assert.strictEqual(config.selectors?.artistNameFallback, 'Safe Artist');
});

test('extract_tour_scrapers - refuses SSRF redirects to blocked hosts', async () => {
  const fetchedUrls: string[] = [];
  global.fetch = (async (url: string) => {
    fetchedUrls.push(url);
    return {
      status: 302,
      ok: false,
      headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null },
      text: async () => ''
    } as any;
  }) as any;

  try {
    const html = await fetchTourHtml('https://artist.example/tour');
    assert.strictEqual(html, null);
    assert.deepStrictEqual(fetchedUrls, ['https://artist.example/tour']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('extract_tour_scrapers - validates generated selectors against fetched HTML before writing', () => {
  const config = buildScraperConfig('Test Artist', 'https://artist.example/tour', {
    selectors: {
      eventBlock: '.show',
      date: '.date',
      venueNameFallback: '',
      cityNameFallback: '',
      countryNameFallback: 'GB'
    }
  });
  assert.ok(config);

  const valid = validateStaticSelectorsAgainstHtml('<div class="show"><span class="date">12 Oct 2026</span></div>', config);
  assert.strictEqual(valid.ok, true);

  const invalid = validateStaticSelectorsAgainstHtml('<div class="show"><span class="day">12 Oct 2026</span></div>', config);
  assert.strictEqual(invalid.ok, false);
});
