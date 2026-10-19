import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../src/pipeline/artistDb.js';
import { buildApprovedMatcher, processConcerts, type ApprovedMatcher } from '../src/pipeline/process.js';
import { loadArtistTargets } from '../src/run-artists.js';
import type { ArtistEntry } from '../src/schemas/artist.js';

let db: ArtistEntry[];
let match: ApprovedMatcher;
before(async () => {
  db = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR);
  match = buildApprovedMatcher(db);
});
const identities: Array<[string, string, string[]]> = [
  ['ДДТ', 'f7456b5b-e5a5-454e-b5db-047308210c8e', ['DDT']],
  ['Нервы', 'd620cf32-e240-46a4-a078-db87acb5ffa0', ['Nervy']],
  ['Oxxxymiron', 'fb2a8279-79cf-4849-b692-1ce674709159', ['Оксимирон']],
  ['Монеточка', '30fcffbe-1083-4e3e-b85a-9b184b97d09f', ['Monetochka']],
  ['Little Big', 'cbe51088-e4d8-463e-9f4e-e83fa64d3f5e', []],
  ['Макс Корж', '38cfabf6-080c-499d-b8e8-b48aa60b7237', ['Max Korzh']],
  ['Zivert', '225712aa-699f-4e77-8547-93dfcdfa5666', ['Зиверт']],
  ['Баста', 'dc453ee9-f2d4-4582-840b-b3be6c79654d', ['Basta']],
  ['Кино', '064db6e8-fdfb-4acb-a327-fc2de75b37de', ['Группа Кино', 'Gruppa Kino']],
  ['Дора', 'd87c14ef-f570-470d-be76-3e2023fa4f61', ['дора']],
  ['MORGENSHTERN', 'ae97ba5f-e7ed-4ed5-9a53-eba415fc49d4', ['Моргенштерн']],
  ['Би-2', '5ca35ace-4006-4d4a-af04-5cd91dafab14', ['Bi-2']],
  ['Сплин', '0783b768-6719-450b-a7e1-7e891da17af3', ['Splean', 'Splin']],
  ['Мумий Тролль', 'f91b9b28-25b7-4064-81d1-f43163085770', ['Mumiy Troll', 'Мумий троль']],
  ['Ляпис Трубецкой', '452b56d2-c904-4030-ad12-6d4fbd498e1f', ['Lyapis Trubetskoy', '♫Ляпис Трубецкой']],
  ['Земфира', 'cec59910-2d12-46ec-8e39-85ca06acb0ed', ['Zemfira', 'Zемфира', 'Земфира Рамазанова']],
];

test('real approved DB resolves the named RU identities and aliases with their verified MBIDs', () => {
  for (const [canonical, mbid, aliases] of identities) {
    for (const input of [canonical, ...aliases]) {
      for (const mode of [undefined, 'exact'] as const) {
        const actual = match(input, mode);
        assert.equal(actual?.name, canonical, `${input}/${mode}`);
        assert.equal(actual?.mbid, mbid, input);
      }
    }
  }
  assert.equal(match('Bi-2')?.website, 'https://b2band.com/ru');
});

test('foreign canonical controls retain their own identities instead of collapsing into RU names', () => {
  for (const [input, mbid] of [
    ['Little Big Town', '76e78b58-f301-4975-8058-7f84d8360738'],
    ['Doro', 'f3e5d65a-0510-4dd2-8bfb-0d06e86b6035'],
    ['Doro Pesch', '8f72ef7e-bc18-4c5d-a4ac-20a5a3a4ab33'],
    ['Morgenstern', '2f9c67a0-19d8-4bb8-b1bf-40157eb4142f'],
    ['Kino', '39568c43-87a3-4711-92dd-7a33bd4e92ef'],
  ]) {
    assert.equal(match(input)?.name, input);
    assert.equal(match(input)?.mbid, mbid);
  }
  assert.equal(match('Dora')?.name, 'Dora', 'unidentified Latin Dora remains separate');
  assert.notEqual(match('Dora')?.mbid, match('Дора')?.mbid);
  assert.ok(!db.find(a => a.name === 'Doro Pesch')!.aliases!.includes('Дора'));
  const de = db.find(a => a.name === 'Morgenstern')!;
  assert.ok(!JSON.stringify(de.socials ?? {}).includes('morgenshtern'));
  assert.notEqual(de.website, match('Моргенштерн')?.website);
});

test('confirmed duplicates leave one artist, retain useful metadata and accept old spellings', () => {
  for (const name of ['Zemfira', 'Lyapis Trubetskoy', '♫Ляпис Трубецкой', 'Мумий троль']) {
    assert.ok(!db.some(a => a.name === name), `${name} is an alias, not a duplicate row`);
  }
  const zemfira = db.find(a => a.name === 'Земфира')!;
  assert.equal(zemfira.website, 'https://zemfira.world');
  assert.equal(zemfira.tier, 'professional');
  assert.ok(zemfira.image);
  assert.ok(zemfira.genres!.includes('russian rock'));
  assert.equal(zemfira.socials!.spotify, 'https://open.spotify.com/artist/6oO3QiWdVj5FZQwbdRtsRh');
  assert.equal(zemfira.socials!.instagram, 'https://www.instagram.com/zemfiraworld');
  assert.ok(zemfira.wikidataSitelinks! >= 63, 'retain the verified person metadata from the Latin row');
  assert.equal(db.find(a => a.name === 'Ляпис Трубецкой')!.website, 'https://lyapis.eu/');
  assert.ok(db.find(a => a.name === 'Ляпис Трубецкой')!.wikidataSitelinks! >= 20);
});

test('existing explicit-target loader admits the RU additions, including longtail Lumen', async () => {
  const file = 'data/artist_scrape_targets.txt';
  const explicit = (await readFile(file, 'utf8')).split('\n').map(x => x.trim()).filter(Boolean);
  const loaded = await loadArtistTargets(file);
  for (const name of [...identities.map(x => x[0]), 'Lumen', 'Noize MC']) {
    assert.ok(explicit.includes(name), `explicit ${name}`);
    assert.ok(loaded.includes(name), `loaded ${name}`);
  }
  assert.ok(!explicit.includes('Мумий троль'));
  assert.ok(!explicit.includes('♫Ляпис Трубецкой'));
});

test('real normalization carries distinct MBIDs for RU artists and foreign controls', async () => {
  // Synthetic complete rows exercise attribution only; these are not collected events.
  const inputs = ['Little Big', 'Little Big Town', 'Дора', 'Doro', 'Моргенштерн', 'Morgenstern', 'Кино', 'Kino', 'Zemfira', 'Bi-2'];
  const rows = inputs.map(artist => ({ artist, date: '2026-11-10', city: 'Berlin', country: 'DE', venue: 'Identity Test Hall', originalSource: 'identity-test.example', scrapedAt: '2026-10-16T12:00:00.000Z' }));
  const result = await processConcerts(rows, PRODUCTION_ARTIST_DB_DIR, '2026-10-16T12:00:00.000Z');
  assert.equal(result.length, inputs.length);
  for (const input of inputs) {
    const expected = match(input)!;
    const row = result.find(r => r.artist === expected.name);
    assert.equal(row?.mbid, expected.mbid, input);
    assert.equal(row?.artistWebsite, expected.website || undefined, input);
  }
});
