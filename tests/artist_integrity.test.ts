import test from 'node:test';
import assert from 'node:assert';
import { checkArtistIntegrity, tallyBySeverity, nameKey, SHARED_URL_WARN_AT } from '../src/pipeline/artist_integrity.js';
import type { ArtistEntry } from '../src/schemas/artist.js';

function artist(name: string, extra: Partial<ArtistEntry> = {}): ArtistEntry {
  return { name, ...extra } as ArtistEntry;
}
function rules(db: ArtistEntry[]): string[] {
  return checkArtistIntegrity(db).map((f) => f.rule);
}

test('a clean catalog produces no findings at all', () => {
  const db = [
    artist('Radiohead', {
      website: 'https://radiohead.com',
      mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      socials: { spotify: 'https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb', instagram: 'https://www.instagram.com/radiohead/' },
      popularity: { listeners: 100, playcount: 200 },
      similarArtists: [{ name: 'Portishead', slug: 'portishead', match: 0.7 }]
    }),
    artist('Аквариум', { website: 'https://aquarium.ru' })
  ];
  assert.deepEqual(checkArtistIntegrity(db), []);
});

test('a link on the wrong platform is an error, not a warning', () => {
  const f = checkArtistIntegrity([artist('X', { socials: { spotify: 'https://music.youtube.com/channel/abc' } })]);
  const wrongPlatform = f.find((x) => x.rule === 'url/wrong-platform');
  assert.ok(wrongPlatform, 'a youtube URL in the spotify field must be flagged');
  assert.equal(wrongPlatform!.severity, 'error');
  assert.ok(f.every((x) => x.severity === 'error'), 'nothing about this value is merely suspicious');
});

test('spotify links must be /artist/<22-char id>', () => {
  const bad = [
    'https://open.spotify.com/artist/0kC5suitedfHlRCRb9Ehtx9',        // 23 chars, contains a word: hallucinated
    'https://open.spotify.com/playlist/0kIQXJyYvLtqvEQWax281k',       // real link, wrong entity
    'spotify:artist:4Z8W4fKeB5YxbusRsdQVPb'                          // URI form, not a URL
  ];
  for (const url of bad) {
    const found = rules([artist('X', { socials: { spotify: url } })]);
    assert.ok(found.includes('spotify/not-an-artist-url') || found.includes('url/unparseable'), `${url} must be flagged`);
  }
  // Locale-prefixed share links are legitimate.
  assert.deepEqual(rules([artist('X', { socials: { spotify: 'https://open.spotify.com/intl-de/artist/4Z8W4fKeB5YxbusRsdQVPb' } })]), []);
});

test('a URL claimed by many artists is warned on; a pair is not', () => {
  const shared = 'https://www.helloproject.com';
  const two = [artist('A', { website: shared }), artist('B', { website: shared })];
  assert.ok(!rules(two).includes('url/shared-across-artists'), `${SHARED_URL_WARN_AT - 1} owners must stay quiet`);

  const many = ['A', 'B', 'C', 'D'].map((n) => artist(n, { website: shared }));
  const f = checkArtistIntegrity(many).filter((x) => x.rule === 'url/shared-across-artists');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warn', 'shared label sites are real — this must never block a merge');
  assert.match(f[0].detail, /4 artists/);
});

test('query strings and trailing slashes do not hide a shared URL', () => {
  const db = [
    artist('A', { website: 'https://example.com/' }),
    artist('B', { website: 'https://example.com' }),
    artist('C', { website: 'https://example.com?utm_source=x' })
  ];
  assert.ok(rules(db).includes('url/shared-across-artists'));
});

test('nameKey collapses punctuation, case and diacritics but keeps script', () => {
  assert.equal(nameKey('H.E.A.T'), nameKey('H.E.A.T.'));
  assert.equal(nameKey('Motörhead'), nameKey('Motorhead'));
  assert.equal(nameKey('Аквариум'), 'аквариум');
  assert.notEqual(nameKey('Haim'), nameKey('Hiam'));
});

test('entries that collapse to one name key are reported once', () => {
  const f = checkArtistIntegrity([artist('H.I.M.'), artist('Him')]).filter((x) => x.rule === 'name/duplicate-entry');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warn');
});

test('junk that is not an artist is surfaced by name shape', () => {
  const found = rules([artist('1964 James Bond film'), artist('Pan Am Flight 103 bombing and subsequent crash')]);
  assert.ok(found.includes('name/contains-date'));
  assert.ok(found.includes('name/too-long'));
});

test('malformed structural values are errors', () => {
  const f = checkArtistIntegrity([
    artist('A', { mbid: 'not-a-uuid' }),
    artist('B', { popularity: { listeners: -1, playcount: 0 } }),
    artist('C', { similarArtists: [{ name: 'Z', slug: 'z', match: 1.5 }] }),
    artist('D', { website: 'ftp://example.com/x' }),
    artist('   ')
  ]);
  const byRule = f.map((x) => x.rule);
  assert.ok(byRule.includes('mbid/malformed'));
  assert.ok(byRule.includes('popularity/negative'));
  assert.ok(byRule.includes('similar/match-out-of-range'));
  assert.ok(byRule.includes('url/unparseable'));
  assert.ok(byRule.includes('name/empty'));
  assert.equal(tallyBySeverity(f).error, byRule.length, 'every one of these must be error severity');
});

test('an aggregator in website is a warning, and only for website', () => {
  const f = checkArtistIntegrity([artist('A', { website: 'https://www.last.fm/music/A' })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'website/aggregator');
  assert.equal(f[0].severity, 'warn');
  // The same host inside a social field is caught by the platform rule instead.
  assert.ok(rules([artist('A', { socials: { instagram: 'https://www.last.fm/music/A' } })]).includes('url/wrong-platform'));
});
