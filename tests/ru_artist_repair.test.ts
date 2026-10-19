import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ArtistEntry } from '../src/schemas/artist.js';
import { repairRuArtistIdentities, repairRuTargets, assertRuIdentityScope, RU_EXPLICIT_TARGETS } from '../src/scripts/repair_ru_artist_identities_20261016.js';

test('finite repair is repeatable, preserves unknown unrelated metadata and rejects identity drift', async () => {
  // Small pre-migration fixture: this finite repair must not depend on bot writes
  // to data/. ru_artist_identity.test.ts covers the real DB integration.
  const fixture: ArtistEntry[] = JSON.parse(await readFile('tests/fixtures/ru-artist-repair/artists.json', 'utf8'));
  const sentinel = { name: 'Unrelated identity sentinel', mbid: 'unchanged', arbitraryFutureField: { nested: ['keep'] } };
  for (const enriched of [false, true]) {
    const input = [...structuredClone(fixture), structuredClone(sentinel)];
    if (enriched) {
      // Same field shapes as cron enrichment. Russian enrichment must survive;
      // the German namesake's mixed metadata is deliberately cleaned by repair.
      const metadata = {
        genres: ['folk metal', 'noise'], image: 'https://fixture.example/artist.jpg',
        metaEnrichedAt: '2026-10-18T00:00:00Z', popularity: { listeners: 123, playcount: 456 },
        similarArtists: [{ name: 'Fixture artist', slug: 'fixture-artist', match: 0.5 }],
      };
      for (const name of ['Morgenstern', 'MORGENSHTERN']) {
        Object.assign(input.find(a => a.name === name)!, structuredClone(metadata));
      }
    }
    const snapshot = structuredClone(input);
    const repaired = repairRuArtistIdentities(input);
    assert.deepEqual(repaired.find(a => a.name === sentinel.name), sentinel, 'unrelated metadata preserved');
    assert.deepEqual(repairRuArtistIdentities(repaired), repaired, 'second run is a complete no-op');
    assert.deepEqual(input, snapshot, 'no mutation of caller input, including nested fields');
    assert.deepEqual(repaired.find(a => a.name === 'MORGENSHTERN'), input.find(a => a.name === 'MORGENSHTERN'), 'Russian enrichment preserved');
    const german = repaired.find(a => a.name === 'Morgenstern')!;
    assert.equal(german.image, undefined, 'mixed German metadata cleaned');
    assert.deepEqual(german.genres, ['noise']);
    const changed = structuredClone(repaired);
    changed.find(a => a.name === sentinel.name)!.arbitraryFutureField.nested.push('unwanted');
    assert.throws(() => assertRuIdentityScope(input, changed));
    const conflict = structuredClone(input);
    conflict.find(a => a.name === 'Little Big')!.mbid = '76e78b58-f301-4975-8058-7f84d8360738';
    assert.throws(() => repairRuArtistIdentities(conflict), /Unexpected identity/);
  }
  // discover_artists also rewrites the live targets file; use fixed input here.
  const targets = await readFile('tests/fixtures/ru-artist-repair/targets.txt', 'utf8');
  const repairedTargets = repairRuTargets(targets);
  assert.equal(repairRuTargets(repairedTargets), repairedTargets, 'targets second run is a complete no-op');
  const lines = repairedTargets.trimEnd().split('\n');
  for (const name of ['Unrelated target', ...RU_EXPLICIT_TARGETS]) assert.ok(lines.includes(name), name);
  for (const name of ['♫Ляпис Трубецкой', 'Мумий троль']) assert.ok(!lines.includes(name), name);
});
