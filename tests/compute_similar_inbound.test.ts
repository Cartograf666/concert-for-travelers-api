import test from 'node:test';
import assert from 'node:assert';
import { applySimilarInboundCounts, computeSimilarInboundCounts } from '../src/scripts/compute_similar_inbound.js';

test('computeSimilarInboundCounts counts incoming similar-artist references by slug', () => {
  const artists: any[] = [
    {
      name: 'The Cure',
      similarArtists: [
        { name: 'Bauhaus', slug: 'bauhaus', match: 0.9 },
        { name: 'Siouxsie and the Banshees', slug: 'siouxsie-and-the-banshees', match: 0.8 }
      ]
    },
    {
      name: 'Bauhaus',
      similarArtists: [
        { name: 'The Cure', slug: 'the-cure', match: 0.95 },
        { name: 'Siouxsie and the Banshees', slug: 'siouxsie-and-the-banshees', match: 0.7 }
      ]
    },
    { name: 'Siouxsie and the Banshees', similarArtists: [{ name: 'The Cure', slug: 'the-cure', match: 0.85 }] },
    { name: 'Unreferenced Artist' }
  ];

  const counts = computeSimilarInboundCounts(artists);
  assert.strictEqual(counts.get('the-cure'), 2);
  assert.strictEqual(counts.get('bauhaus'), 1);
  assert.strictEqual(counts.get('siouxsie-and-the-banshees'), 2);
});

test('applySimilarInboundCounts writes 0 for artists nobody points to', () => {
  const artists: any[] = [
    { name: 'Alpha', similarArtists: [{ name: 'Beta', slug: 'beta', match: 0.9 }] },
    { name: 'Beta' },
    { name: 'Gamma' }
  ];

  const changed = applySimilarInboundCounts(artists);
  assert.strictEqual(changed, 3);
  assert.deepStrictEqual(artists.map((a) => [a.name, a.similarInboundCount]), [
    ['Alpha', 0],
    ['Beta', 1],
    ['Gamma', 0]
  ]);
});
