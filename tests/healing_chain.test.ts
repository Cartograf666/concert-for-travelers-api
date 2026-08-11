import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { chainSelectorRepair, ChainCandidate } from '../src/healing/chain.js';
import { VerifyReport } from '../src/healing/verify.js';
import { ScraperConfig } from '../src/schemas/config.js';

const ORIGINAL: ScraperConfig = {
  id: 'artist-example',
  domain: 'example.com',
  url: 'https://example.com/old-tour',
  type: 'static_selectors',
  selectors: {
    eventBlock: '.old',
    date: '.old-date',
    venueNameFallback: '',
    cityNameFallback: '',
    countryNameFallback: 'US'
  }
};

const RELOCATED: ScraperConfig = { ...ORIGINAL, url: 'https://example.com/shows' };
const RESELECTED: ScraperConfig = {
  ...RELOCATED,
  selectors: { ...ORIGINAL.selectors!, eventBlock: '.new-event', date: '.new-date' }
};

const chain = (reason: string): ChainCandidate => ({
  config: RELOCATED,
  htmlSample: '<div class="new-event"><span class="new-date">2026-09-01</span></div>',
  reason
});

const pass: VerifyReport = { ok: true, eventCount: 9, checks: [] };
const fail: VerifyReport = { ok: false, eventCount: 0, checks: [{ name: 'has_events', ok: false, detail: '0' }] };

async function fixture(): Promise<{ dir: string; configPath: string; originalRaw: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heal-chain-'));
  const configPath = path.join(dir, 'artist-example.json');
  const originalRaw = JSON.stringify(ORIGINAL, null, 2);
  await fs.writeFile(configPath, originalRaw, 'utf-8');
  return { dir, configPath, originalRaw };
}

const readConfig = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

test('chain - re-selects on the relocated URL and accepts a passing repair', async () => {
  const { configPath, originalRaw } = await fixture();
  let repairedAt: string | undefined;

  const result = await chainSelectorRepair('artist-example', configPath, originalRaw, chain('selectors_stale'), {
    repairConfig: async (p, html) => {
      // The repair must see the relocated URL already written to disk, and the
      // markup from the live probe rather than the stale original sample.
      repairedAt = (await readConfig(p)).url;
      assert.match(html, /new-event/);
      await fs.writeFile(p, JSON.stringify(RESELECTED, null, 2), 'utf-8');
      return { success: true, config: RESELECTED };
    },
    verify: async () => pass,
    hasLlmKey: true
  });

  assert.strictEqual(repairedAt, 'https://example.com/shows');
  assert.strictEqual(result?.config.url, 'https://example.com/shows');
  assert.match(result!.note, /relocated .* re-selected/);
  assert.strictEqual((await readConfig(configPath)).selectors.eventBlock, '.new-event');
});

test('chain - restores the original config when the gate rejects the re-selection', async () => {
  const { configPath, originalRaw } = await fixture();

  const result = await chainSelectorRepair('artist-example', configPath, originalRaw, chain('selectors_stale'), {
    repairConfig: async (p) => {
      await fs.writeFile(p, JSON.stringify(RESELECTED, null, 2), 'utf-8');
      return { success: true, config: RESELECTED };
    },
    verify: async () => fail,
    hasLlmKey: true
  });

  assert.strictEqual(result, null);
  // The rejected repair must not survive in the working tree -- otherwise it would
  // be committed by the PR step regardless of the gate's verdict.
  assert.deepStrictEqual(await readConfig(configPath), ORIGINAL);
});

test('chain - restores the original config when the repair itself fails', async () => {
  const { configPath, originalRaw } = await fixture();

  const result = await chainSelectorRepair('artist-example', configPath, originalRaw, chain('selectors_stale'), {
    repairConfig: async (p) => {
      await fs.writeFile(p, '{"garbage": true}', 'utf-8');
      return { success: false, error: 'all models failed' };
    },
    verify: async () => pass,
    hasLlmKey: true
  });

  assert.strictEqual(result, null);
  assert.deepStrictEqual(await readConfig(configPath), ORIGINAL);
});

test('chain - a client-rendered page switches to playwright_render without an LLM', async () => {
  const { configPath, originalRaw } = await fixture();
  const verified: ScraperConfig[] = [];

  const result = await chainSelectorRepair('artist-example', configPath, originalRaw, chain('csr_detected'), {
    repairConfig: async () => { throw new Error('must not call the LLM for a CSR page'); },
    verify: async (c) => { verified.push(c); return pass; },
    hasLlmKey: false
  });

  assert.strictEqual(result?.config.type, 'playwright_render');
  assert.strictEqual(result?.config.url, 'https://example.com/shows');
  assert.strictEqual(verified.length, 1);
});

test('chain - without a Gemini key the selector path gives up without touching the config', async () => {
  const { configPath, originalRaw } = await fixture();

  const result = await chainSelectorRepair('artist-example', configPath, originalRaw, chain('selectors_stale'), {
    repairConfig: async () => { throw new Error('must not be called without a key'); },
    verify: async () => pass,
    hasLlmKey: false
  });

  assert.strictEqual(result, null);
  assert.deepStrictEqual(await readConfig(configPath), ORIGINAL);
});
