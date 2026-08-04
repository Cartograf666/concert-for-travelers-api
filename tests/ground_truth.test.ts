import test from 'node:test';
import assert from 'node:assert';
import { compareLink, compareEntry } from '../src/pipeline/ground_truth.js';

test('a website matches on host, not on the exact path we happened to store', () => {
  assert.equal(compareLink('website', 'http://radiohead.com/news', 'https://www.radiohead.com/'), 'confirmed');
  assert.equal(compareLink('website', 'https://radiohead.com', 'https://thombeyorke.com'), 'conflict');
});

test('social links match on handle across URL shapes', () => {
  assert.equal(compareLink('instagram', 'https://instagram.com/radiohead', 'https://www.instagram.com/radiohead/'), 'confirmed');
  assert.equal(compareLink('instagram', 'https://www.instagram.com/@radiohead', 'https://www.instagram.com/radiohead'), 'confirmed');
  assert.equal(compareLink('spotify', 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb?si=x', 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb'), 'confirmed');
  assert.equal(compareLink('spotify', 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb', 'https://open.spotify.com/artist/1Yox196W7bzVNZI7RBaPnf'), 'conflict');
});

test('a missing value on either side is never a conflict', () => {
  assert.equal(compareLink('website', null, 'https://x.com'), 'unknown');
  assert.equal(compareLink('website', 'https://x.com', null), 'unknown');
  assert.equal(compareLink('website', 'not a url', 'https://x.com'), 'unknown');
});

test('youtube channel-id vs handle is a shape difference, not a defect', () => {
  // Wikidata stores UC...; enrichment stores the human-facing form. Same channel.
  assert.equal(compareLink('youtube', 'https://www.youtube.com/user/radioheadtv', 'https://www.youtube.com/channel/UCv4chJyVsfstwMdvSjRK8fA'), 'unknown');
  // Two different channel ids ARE comparable, and disagree.
  assert.equal(compareLink('youtube', 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb'), 'conflict');
});

test('compareEntry judges only fields we actually hold', () => {
  const ours = { website: 'https://a.example', socials: { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb' } };
  const theirs = { website: 'https://b.example', socials: { instagram: 'https://www.instagram.com/x' } };
  const out = compareEntry(ours, theirs);
  assert.deepEqual(out.map((c) => c.field), ['website', 'spotify']);
  assert.equal(out[0].verdict, 'conflict');
  assert.equal(out[1].verdict, 'unknown', 'Wikidata having no spotify id says nothing about ours');
});
