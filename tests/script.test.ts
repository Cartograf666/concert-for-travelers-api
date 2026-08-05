import test from 'node:test';
import assert from 'node:assert';
import { isReadableScript, hasUnreadableScript, pickReadable, isLatinScript } from '../src/pipeline/script.js';

test('Latin names, including diacritics and symbols, are readable', () => {
  for (const s of ['Tokyo', 'Björk', 'Motörhead', '!!!', 'AC/DC', 'Sigur Rós', 'Zepp Tokyo', 'M83', 'P!nk', 'Israel Kamakawiwoʻole', 'O’Brien']) {
    assert.equal(isReadableScript(s), true, `${s} must be publishable`);
  }
});

test('Cyrillic is readable -- the feed serves Russian too', () => {
  for (const s of ['Аквариум', 'Мумий Тролль', 'Ленинград', 'Москва', 'Санкт-Петербург']) {
    assert.equal(isReadableScript(s), true, `${s} must not be filtered out`);
    assert.equal(hasUnreadableScript(s), false);
  }
});

test('everything else is unreadable, in every script the catalog actually carries', () => {
  for (const s of ['東京', '東京事変', 'マイリー・サイラス', '방탄소년단', 'ไมลีย์ ไซรัส', 'מיילי סיירוס', 'مايلي سايرس', 'Ελευθερία', 'მაილი საირუსი', 'माईली']) {
    assert.equal(isReadableScript(s), false, `${s} must not reach the feed`);
    assert.equal(hasUnreadableScript(s), true);
  }
});

test('a mixed string is rejected -- half-readable is not readable', () => {
  assert.equal(isReadableScript('Zepp 東京'), false);
  assert.equal(isReadableScript('東京 Jihen'), false);
  assert.equal(isReadableScript('Клуб 東京'), false);
});

test('a letterless string is readable -- judging plausibility is a different job', () => {
  assert.equal(isReadableScript('2026'), true);
  assert.equal(isReadableScript('---'), true);
  assert.equal(isReadableScript(''), false, 'nothing at all is still nothing');
});

test('isLatinScript separates the primary language from the secondary one', () => {
  assert.equal(isLatinScript('Moscow'), true);
  assert.equal(isLatinScript('Москва'), false, 'readable, but not Latin');
  assert.equal(isLatinScript('東京'), false);
});

test('pickReadable prefers Latin, falls back to Cyrillic, and gives up honestly', () => {
  assert.equal(pickReadable(['東京', 'Tokyo', 'Tokyo Metropolis']), 'Tokyo');
  assert.equal(pickReadable(['Москва', 'Moscow']), 'Moscow', 'English feed prefers the Latin spelling');
  assert.equal(pickReadable(['東京', 'Москва']), 'Москва', 'Cyrillic beats returning nothing');
  assert.equal(pickReadable(['東京', '東京都']), null, 'no readable variant means no answer, not a guess');
  assert.equal(pickReadable(['Tokyo', 'Tokio'], false), 'Tokio', 'stable ordering when brevity is not wanted');
});

// --- catalog naming ----------------------------------------------------------
import { publishArtistCatalog } from '../src/generator/publish.js';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as pathMod from 'path';

test('the catalog publishes an English name and keeps the native one alongside', async () => {
  const dir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'catalog-'));
  await publishArtistCatalog(
    [
      { name: 'ヨルシカ', displayName: 'Yorushika', aliases: ['ヨルシカ', 'Yorushika'] },
      { name: 'Radiohead', aliases: ['レディオヘッド', 'Radio Head'] },
      { name: '初星学園' } // no label anywhere -- must still appear, untranslated
    ],
    dir
  );
  const catalog = JSON.parse(await fsp.readFile(pathMod.join(dir, 'artists.json'), 'utf-8'));
  const byNative = new Map(catalog.map((e: any) => [e.nameNative ?? e.name, e]));

  const yorushika: any = byNative.get('ヨルシカ');
  assert.equal(yorushika.name, 'Yorushika');
  assert.equal(yorushika.nameNative, 'ヨルシカ', 'the native spelling stays searchable');
  assert.deepEqual(yorushika.aliases, ['Yorushika'], 'unreadable aliases are dropped');

  const radiohead: any = byNative.get('Radiohead');
  assert.equal(radiohead.name, 'Radiohead');
  assert.equal(radiohead.nameNative, undefined, 'no rename means no extra field');
  assert.deepEqual(radiohead.aliases, ['Radio Head']);

  const untranslated: any = byNative.get('初星学園');
  assert.equal(untranslated.name, '初星学園', 'better present and unreadable than missing');
  assert.equal(untranslated.nameNative, undefined);
});
