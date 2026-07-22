import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { enrichMissingArtistMetadata, GenerateEnrichmentFn } from '../src/pipeline/enrich.js';
import { mergeArtistAliases } from '../src/pipeline/artistAliases.js';
import { selectPendingWikidataBulkArtists } from '../src/scripts/enrich_wikidata_bulk.js';

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

function notFoundError(): Error {
  const err: any = new Error('404 Not Found: model does not exist');
  err.status = 404;
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

test('Enrich - a 404 (unknown/deprecated model) is treated the same as a quota error: skip it, do not retry', async () => {
  // Real case this guards against: a stale model ID (e.g. a retired Gemini
  // version) left in the cascade would 404 on every single call otherwise.
  const artists = Array.from({ length: 15 }, (_, i) => `Artist ${i}`);
  const file = await tempArtistsFile(artists.map((name) => ({ name, website: null })));

  const callsByModel: Record<string, number> = {};
  const generateFn: GenerateEnrichmentFn = async ({ modelName }) => {
    callsByModel[modelName] = (callsByModel[modelName] || 0) + 1;
    if (modelName === 'model-a') throw notFoundError();
    return JSON.stringify([]);
  };

  await enrichMissingArtistMetadata(artists, file, 'fake-key', generateFn, TEST_MODELS);

  assert.strictEqual(callsByModel['model-a'], 1, 'the 404 model should only be tried once, then skipped like a quota-exhausted one');
  assert.strictEqual(callsByModel['model-b'], 1, 'the next model in the cascade should still be tried and succeed');

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

test('Enrich - refuses to add a brand-new artist that is on the denylist', async () => {
  // Real production denylist term ("music", data/artist_denylist.json), not in
  // data/artist_scrape_targets.txt -- confirms the intake guard from
  // src/pipeline/denylist.ts fires against the actual repo denylist file.
  const file = await tempArtistsFile([{ name: 'Some Other Artist', website: null }]);

  const generateFn: GenerateEnrichmentFn = async () => {
    return JSON.stringify([{ name: 'Music', website: null, socials: {} }]);
  };

  await enrichMissingArtistMetadata(['Some Other Artist'], file, 'fake-key', generateFn, TEST_MODELS);

  const final = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.strictEqual(final.find((a: any) => a.name.toLowerCase() === 'music'), undefined, 'denylisted term must not be added as a new artist');

  await fs.unlink(file);
});

test('Enrich - preserves existing socials when not returned by LLM', async () => {
  const file = await tempArtistsFile([{
    name: 'Artist A',
    website: null,
    socials: {
      spotify: 'https://spotify.com/artist/a',
      instagram: 'https://instagram.com/a'
    }
  }]);

  const generateFn: GenerateEnrichmentFn = async () => {
    return JSON.stringify([{
      name: 'Artist A',
      website: 'https://new.example',
      socials: {
        instagram: 'https://instagram.com/new-a'
      }
    }]);
  };

  await enrichMissingArtistMetadata(['Artist A'], file, 'fake-key', generateFn, TEST_MODELS);

  const final = JSON.parse(await fs.readFile(file, 'utf-8'));
  const artist = final.find((a: any) => a.name === 'Artist A');
  
  assert.strictEqual(artist.website, 'https://new.example');
  assert.strictEqual(artist.socials.spotify, 'https://spotify.com/artist/a');
  assert.strictEqual(artist.socials.instagram, 'https://instagram.com/new-a');
  assert.strictEqual(artist.socials.facebook, null);

  await fs.unlink(file);
});

test('Enrich - buildQuery includes skos:altLabel field for Wikidata alias extraction', () => {
  const { buildQuery } = require('../src/scripts/enrich_wikidata_bulk.js');
  const query = buildQuery(['The Beatles']);
  assert.ok(query.includes('skos:altLabel'), 'SPARQL query should include skos:altLabel for alias extraction');
  assert.ok(query.includes('?altLabel'), 'SPARQL query should request ?altLabel in SELECT projection');
});

test('Enrich - Wikidata alias backfill selects existing bulk-processed artists once', () => {
  const artists: any[] = [
    { name: 'Already enriched', enrichedAt: '2026-01-01', wdBulkTriedAt: '2026-01-01' },
    { name: 'Already backfilled', wdAliasesTriedAt: '2026-01-01' }
  ];

  assert.deepStrictEqual(selectPendingWikidataBulkArtists(artists, 10).map((artist) => artist.name), ['Already enriched']);
});

test('Enrich - alias merge ignores canonical and normalized duplicates', () => {
  const artist: any = { name: 'The Beatles', aliases: ['Fab Four'] };
  assert.strictEqual(mergeArtistAliases(artist, ['The Beatles', 'fab-four', 'Битлз']), true);
  assert.deepStrictEqual(artist.aliases, ['Fab Four', 'Битлз']);

  const canonicalOnly: any = { name: 'The Beatles', aliases: ['The Beatles'] };
  assert.strictEqual(mergeArtistAliases(canonicalOnly, []), true);
  assert.strictEqual(canonicalOnly.aliases, undefined);
});

test('Enrich - alias merge works independently of website or socials metadata', () => {
  const artist: any = { name: 'The Beatles' };
  assert.strictEqual(mergeArtistAliases(artist, ['Fab Four', 'Битлз']), true);
  assert.deepStrictEqual(artist.aliases, ['Fab Four', 'Битлз']);
});

