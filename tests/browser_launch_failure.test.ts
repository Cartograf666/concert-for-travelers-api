import test from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import { closeBrowser, runScraper } from '../src/engine/runner.js';
import type { ScraperConfig } from '../src/schemas/config.js';

function within<T>(promise: Promise<T>, ms = 250): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`operation did not settle within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('a failed shared Chromium launch settles promptly and the next scrape retries cleanly', async () => {
  const ownLaunch = Object.getOwnPropertyDescriptor(chromium, 'launch');
  let launches = 0;
  let browserCloses = 0;
  let pageCloses = 0;
  let firstSettled = false;

  const fakePage = {
    route: async () => {},
    goto: async () => {},
    content: async () => '<div class="event"><span class="artist">The Cure</span><time>2026-10-12</time></div>',
    close: async () => { pageCloses++; }
  };
  const fakeBrowser = {
    newPage: async () => fakePage,
    close: async () => { browserCloses++; }
  };

  Object.defineProperty(chromium, 'launch', {
    configurable: true,
    writable: true,
    value: async () => {
      launches++;
      if (launches === 1) throw new Error('mock missing chromium_headless_shell-1243');
      return fakeBrowser;
    }
  });

  const config: ScraperConfig = {
    id: 'browser-launch-retry',
    domain: 'browser-launch-retry.example',
    url: 'https://browser-launch-retry.example/events',
    type: 'playwright_render',
    selectors: {
      eventBlock: '.event',
      artist: '.artist',
      date: 'time',
      venueNameFallback: 'Retry Hall',
      cityNameFallback: 'Berlin',
      countryNameFallback: 'DE'
    }
  };

  try {
    const first = await within(runScraper(config));
    firstSettled = true;
    assert.equal(first.success, false);
    assert.equal(first.reason, 'fetch_error');
    assert.match(first.error ?? '', /mock missing chromium_headless_shell-1243/);

    const second = await within(runScraper(config));
    assert.equal(second.success, true);
    assert.equal(second.concerts.length, 1);
    assert.equal(second.concerts[0].artist, 'The Cure');
    assert.equal(launches, 2, 'the rejected shared launch must not poison the next attempt');

    await within(closeBrowser());
    assert.equal(browserCloses, 1);
    assert.equal(pageCloses, 1);
  } finally {
    if (ownLaunch) Object.defineProperty(chromium, 'launch', ownLaunch);
    else delete (chromium as unknown as { launch?: unknown }).launch;
    // Under the broken implementation closeBrowser deadlocks on the same launch
    // promise. Do not create a second timeout in cleanup; the red assertion above
    // already proves that lifecycle defect deterministically.
    if (firstSettled) await closeBrowser();
  }
});
