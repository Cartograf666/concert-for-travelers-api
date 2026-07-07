import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { enrichMissingArtistMetadata, GenerateEnrichmentFn } from '../src/pipeline/enrich.js';

async function tempArtistsFile(entries: any[]): Promise<string> {
  const file = path.join(os.tmpdir(), `test-artists-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf-8');
  return file;
}

function quotaError(): Error {
  const err: any = new Error('429 Too Many Requests');
  err.status = 429;
  return err;
}

// Synthetic model names, independent of the real DEFAULT_ENRICHMENT_MODELS cascade
// (which changes over time as models are added/deprecated) -- these tests exercise
// the cascade MECHANISM, not any specific real model lineup.
const TEST_MODELS = ['model-a', 'model-b', 'model-c', 'model-d', 'model-e', 'model-f'];

test('Enrich - stops the whole run once every model is quota-exhausted, instead of retrying dead models per batch', async () => {
  // 45 artists = 3 batches of 15. Every model call fails with a quota error, so by
  // the time batch 1 exhausts all 6 test models, batches 2 and 3 must be skipped
  // entirely -- not attempted at all -- rather than each burning through 6 more
  // doomed calls.
  const artists = Array.from({ length: 45 }, (_, i) => `Artist ${i}`);
  const file = await tempArtistsFile(artists.map((name) => ({ name, website: null })));

  let callCount = 0;
  const generateFn: GenerateEnrichmentFn = async () => {
    callCount++;
    throw quotaError();
  };

  await enrichMissingArtistMetadata(artists, file, 'fake-key', generateFn, TEST_MODELS);

  // Exactly one model-exhaustion pass (6 calls) for batch 1, then early exit --
  // not 3 batches x 6 models = 18 calls.
  assert.strictEqual(callCount, TEST_MODELS.length, `expected exactly ${TEST_MODELS.length} calls (one full model sweep before exhaustion), got ${callCount}`);

  await fs.unlink(file);
});

test('Enrich - a model that already failed with a quota error is not retried on the next batch', async () => {
  // 30 artists = 2 batches. model-a always quota-errors; model-b always succeeds.
  // Batch 1 should try both (a fails, b succeeds). Batch 2 should try ONLY b -- "a"
  // was already marked exhausted in batch 1 and must be skipped, not retried.
  const artists = Array.from({ length: 30 }, (_, i) => `Artist ${i}`);
  const file = await tempArtistsFile(artists.map((name) => ({ name, website: null })));

  const callsByModel: Record<string, number> = {};
  const generateFn: GenerateEnrichmentFn = async ({ modelName }) => {
    callsByModel[modelName] = (callsByModel[modelName] || 0) + 1;
    if (modelName === 'model-a') throw quotaError();
    return JSON.stringify([]);
  };

  await enrichMissingArtistMetadata(artists, file, 'fake-key', generateFn, TEST_MODELS);

  assert.strictEqual(callsByModel['model-a'], 1, 'the quota-exhausted model should only be tried once across the whole run');
  assert.strictEqual(callsByModel['model-b'], 2, 'the working model should be tried once per batch (2 batches)');

  await fs.unlink(file);
});

test('Enrich - saves progress after every batch, not only at the end', async () => {
  const artists = ['Artist A', 'Artist B'];
  const file = await tempArtistsFile(artists.map((name) => ({ name, website: null })));

  let sawIntermediateWrite = false;
  const generateFn: GenerateEnrichmentFn = async ({ modelName }) => {
    if (modelName !== 'model-a') throw new Error('should not reach this model');
    // Mid-batch, before this function returns, the artist list on disk should
    // still reflect the ORIGINAL null website (nothing saved for THIS batch yet) --
    // confirms saving happens after processing, once per batch, not before.
    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8'));
    if (onDisk.find((a: any) => a.name === 'Artist A')?.website === null) {
      sawIntermediateWrite = true;
    }
    return JSON.stringify([{ name: 'Artist A', website: 'https://a.example', socials: {} }]);
  };

  await enrichMissingArtistMetadata(artists, file, 'fake-key', generateFn, TEST_MODELS);
  assert.ok(sawIntermediateWrite, 'expected to observe the pre-batch-save state on disk during the call');

  const final = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.strictEqual(final.find((a: any) => a.name === 'Artist A').website, 'https://a.example');

  await fs.unlink(file);
});
