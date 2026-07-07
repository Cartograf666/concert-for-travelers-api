import test from 'node:test';
import assert from 'node:assert';
import { cleanAndParseSelectors, testSelectorsOnHtml, repairScraperConfig, GenerateSelectorsFn, DEFAULT_REPAIR_MODELS } from '../src/healing/repair.js';
import { ScraperConfig } from '../src/schemas/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';

test('Healing - clean and parse selectors', () => {
  // Test with markdown code block
  const markdownText = '```json\n{\n  "eventBlock": ".event-card",\n  "artist": ".artist"\n}\n```';
  const parsed = cleanAndParseSelectors(markdownText);
  assert.strictEqual(parsed.eventBlock, '.event-card');
  assert.strictEqual(parsed.artist, '.artist');

  // Test with plain JSON
  const plainText = '{\n  "eventBlock": ".event-card-plain",\n  "artist": ".artist-plain"\n}';
  const parsedPlain = cleanAndParseSelectors(plainText);
  assert.strictEqual(parsedPlain.eventBlock, '.event-card-plain');
  assert.strictEqual(parsedPlain.artist, '.artist-plain');
});

test('Healing - test selectors on HTML snippet', () => {
  const html = `
    <div class="event-card">
      <h2 class="artist">The Cure</h2>
      <span class="date">12. Okt 2026</span>
      <a class="tickets" href="/buy/1">Tickets</a>
    </div>
  `;

  const config: ScraperConfig = {
    id: 'test-healer',
    domain: 'test-healer.de',
    url: 'http://localhost:9999/test-healer',
    type: 'static_selectors',
    selectors: {
      eventBlock: '.event-card',
      artist: '.artist',
      date: '.date',
      ticketUrl: '.tickets',
      venueNameFallback: 'Venue',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };

  // Test working selectors
  const workingSelectors = {
    eventBlock: '.event-card',
    artist: '.artist',
    date: '.date',
    ticketUrl: '.tickets',
    venueNameFallback: 'Venue',
    cityNameFallback: 'Berlin',
    countryNameFallback: 'DE'
  };

  const concerts = testSelectorsOnHtml(workingSelectors, config, html);
  assert.strictEqual(concerts.length, 1);
  assert.strictEqual(concerts[0].artist, 'The Cure');
  assert.strictEqual(concerts[0].date, '12. Okt 2026');
  assert.strictEqual(concerts[0].ticketUrl, 'http://localhost:9999/buy/1');

  // Test failing selectors (should throw error)
  const failingSelectors = {
    ...workingSelectors,
    eventBlock: '.non-existent'
  };

  assert.throws(() => {
    testSelectorsOnHtml(failingSelectors, config, html);
  }, /Selector "eventBlock" \(\.non-existent\) matched 0 elements\./);
});

test('Healing - repairScraperConfig end-to-end with mocked Gemini API', async () => {
  const tempConfigDir = path.join(process.cwd(), 'reports', 'temp_tests');
  await fs.mkdir(tempConfigDir, { recursive: true });
  const tempConfigPath = path.join(tempConfigDir, 'broken-scraper.json');

  const brokenConfig: ScraperConfig = {
    id: 'broken-scraper',
    domain: 'broken-scraper.de',
    url: 'https://test-fixture.example/broken',
    type: 'static_selectors',
    selectors: {
      eventBlock: '.old-card-class', // broken
      artist: '.artist',
      date: '.date',
      ticketUrl: '.tickets',
      venueNameFallback: 'Original Venue',
      cityNameFallback: 'Original City',
      countryNameFallback: 'DE'
    }
  };

  await fs.writeFile(tempConfigPath, JSON.stringify(brokenConfig, null, 2), 'utf-8');

  const updatedHtml = `
    <div class="new-card-class">
      <h2 class="artist">The Cure</h2>
      <span class="date">12. Okt 2026</span>
    </div>
  `;

  // Inject a fake structured-output generator instead of hitting the real Gemini
  // API -- this exercises the exact same cascade/validation/save path as production,
  // just swapping out the network call.
  const fakeGenerateSelectors: GenerateSelectorsFn = async ({ prompt, modelName }) => {
    assert.ok(DEFAULT_REPAIR_MODELS.includes(modelName), `Model ${modelName} should be in the cascade`);
    assert.ok(prompt.includes('broken-scraper'));
    assert.ok(prompt.includes('new-card-class'));
    return {
      eventBlock: '.new-card-class',
      artist: '.artist',
      date: '.date',
      ticketUrl: '.tickets'
    };
  };

  try {
    const res = await repairScraperConfig(tempConfigPath, updatedHtml, 'MOCK_API_KEY', fakeGenerateSelectors);

    assert.strictEqual(res.success, true);
    assert.ok(res.config);
    assert.strictEqual(res.config.selectors?.eventBlock, '.new-card-class');
    // Fallback names must come from the trusted original config, not the "LLM" output.
    assert.strictEqual(res.config.selectors?.venueNameFallback, 'Original Venue');

    // Read back config file to confirm update
    const savedContent = await fs.readFile(tempConfigPath, 'utf-8');
    const savedConfig = JSON.parse(savedContent);
    assert.strictEqual(savedConfig.selectors.eventBlock, '.new-card-class');

  } finally {
    // Cleanup temp files
    await fs.rm(tempConfigDir, { recursive: true, force: true });
  }
});

test('Healing - model cascade stops early on an auth/quota error instead of trying every model', async () => {
  const tempConfigDir = path.join(process.cwd(), 'reports', 'temp_tests_auth');
  await fs.mkdir(tempConfigDir, { recursive: true });
  const tempConfigPath = path.join(tempConfigDir, 'broken-scraper.json');

  const brokenConfig: ScraperConfig = {
    id: 'broken-scraper',
    domain: 'broken-scraper.de',
    url: 'https://test-fixture.example/broken',
    type: 'static_selectors',
    selectors: {
      eventBlock: '.old-card-class',
      artist: '.artist',
      date: '.date',
      venueNameFallback: 'Original Venue',
      cityNameFallback: 'Original City',
      countryNameFallback: 'DE'
    }
  };
  await fs.writeFile(tempConfigPath, JSON.stringify(brokenConfig, null, 2), 'utf-8');

  let attempts = 0;
  const authErrorGenerator: GenerateSelectorsFn = async () => {
    attempts++;
    const err: any = new Error('API key not valid');
    err.statusCode = 401;
    throw err;
  };

  try {
    const res = await repairScraperConfig(tempConfigPath, '<div></div>', 'BAD_KEY', authErrorGenerator);
    assert.strictEqual(res.success, false);
    // Only the first model in the cascade should have been tried.
    assert.strictEqual(attempts, 1);
  } finally {
    await fs.rm(tempConfigDir, { recursive: true, force: true });
  }
});
