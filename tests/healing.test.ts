import test from 'node:test';
import assert from 'node:assert';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { cleanAndParseSelectors, testSelectorsOnHtml, repairScraperConfig } from '../src/healing/repair.js';
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
    url: 'http://localhost:9999/broken',
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

  // Mock Gemini client prototype getGenerativeModel
  const originalGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel;

  GoogleGenerativeAI.prototype.getGenerativeModel = function (options: any) {
    assert.strictEqual(options.model, 'gemini-2.5-flash');
    return {
      generateContent: async (prompt: string) => {
        assert.ok(prompt.includes('broken-scraper'));
        assert.ok(prompt.includes('new-card-class'));
        
        return {
          response: {
            text: () => JSON.stringify({
              eventBlock: '.new-card-class',
              artist: '.artist',
              date: '.date',
              ticketUrl: '.tickets',
              venueNameFallback: 'Original Venue',
              cityNameFallback: 'Original City',
              countryNameFallback: 'DE'
            })
          }
        };
      }
    } as any;
  };

  try {
    const res = await repairScraperConfig(tempConfigPath, updatedHtml, 'MOCK_API_KEY');

    assert.strictEqual(res.success, true);
    assert.ok(res.config);
    assert.strictEqual(res.config.selectors?.eventBlock, '.new-card-class');

    // Read back config file to confirm update
    const savedContent = await fs.readFile(tempConfigPath, 'utf-8');
    const savedConfig = JSON.parse(savedContent);
    assert.strictEqual(savedConfig.selectors.eventBlock, '.new-card-class');

  } finally {
    // Restore original prototype function
    GoogleGenerativeAI.prototype.getGenerativeModel = originalGetGenerativeModel;
    // Cleanup temp files
    await fs.rm(tempConfigDir, { recursive: true, force: true });
  }
});
