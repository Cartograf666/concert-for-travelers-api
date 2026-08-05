import test from 'node:test';
import assert from 'node:assert';
import { isLatinReadable, hasNonLatinLetters, pickLatin } from '../src/pipeline/script.js';

test('Latin names, including diacritics and symbols, are readable', () => {
  for (const s of ['Tokyo', 'Björk', 'Motörhead', '!!!', 'AC/DC', 'Sigur Rós', 'Zepp Tokyo', 'M83', 'P!nk']) {
    assert.equal(isLatinReadable(s), true, `${s} must be publishable`);
  }
});

test('non-Latin scripts are not readable, in every script the catalog actually carries', () => {
  for (const s of ['東京', '東京事変', 'マイリー・サイラス', '방탄소년단', 'Аквариум', 'ไมลีย์ ไซรัส', 'מיילי סיירוס', 'مايلي سايرس', 'Ελευθερία', 'მაილი საირუსი']) {
    assert.equal(isLatinReadable(s), false, `${s} must not reach an English feed`);
    assert.equal(hasNonLatinLetters(s), true);
  }
});

test('a mixed string is rejected -- half-readable is not readable', () => {
  assert.equal(isLatinReadable('Zepp 東京'), false);
  assert.equal(isLatinReadable('東京 Jihen'), false);
});

test('a letterless string is readable -- judging plausibility is a different job', () => {
  assert.equal(isLatinReadable('2026'), true);
  assert.equal(isLatinReadable('---'), true);
  assert.equal(isLatinReadable(''), false, 'nothing at all is still nothing');
});

test('pickLatin prefers the bare English spelling and gives up honestly', () => {
  assert.equal(pickLatin(['東京', 'Tokyo', 'Tokyo Metropolis']), 'Tokyo');
  assert.equal(pickLatin(['東京', '東京都']), null, 'no Latin variant means no answer, not a guess');
  assert.equal(pickLatin(['Tokyo', 'Tokio'], false), 'Tokio', 'stable ordering when brevity is not wanted');
});
