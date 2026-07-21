import test from 'node:test';
import assert from 'node:assert';
import { selectProfessionalSlugs } from '../src/scripts/score_artist_popularity.js';

test('score_artist_popularity - protected targets count against the professional cap', () => {
  const scored = [
    { slug: 'protected-a', score: 10 },
    { slug: 'protected-b', score: 9 },
    { slug: 'protected-c', score: 8 },
    { slug: 'threshold-hit', score: 7 }
  ];

  const selected = selectProfessionalSlugs(scored, 1, new Set(['protected-a', 'protected-b', 'protected-c']), 3);

  assert.deepStrictEqual([...selected], ['protected-a', 'protected-b', 'protected-c']);
  assert.strictEqual(selected.has('threshold-hit'), false);
  assert.strictEqual(selected.size, 3);
});

test('score_artist_popularity - threshold rows fill only the remaining cap after protected rows', () => {
  const scored = [
    { slug: 'hit-a', score: 10 },
    { slug: 'hit-b', score: 8 },
    { slug: 'hit-c', score: 7 },
    { slug: 'protected', score: 0 }
  ];

  const selected = selectProfessionalSlugs(scored, 7, new Set(['protected']), 3);

  assert.deepStrictEqual([...selected], ['protected', 'hit-a', 'hit-b']);
  assert.strictEqual(selected.has('hit-c'), false);
});
