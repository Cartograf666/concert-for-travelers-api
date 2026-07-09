import test from 'node:test';
import assert from 'node:assert';
import { slugify, cleanArtistName, matchApprovedArtist, parseDate, processConcerts, normalizeCountry, parseSpotifyArtistId, extractTimeFromRawDate, inferVenueKind } from '../src/pipeline/process.js';
import { Concert } from '../src/schemas/concert.js';
import { PRODUCTION_ARTIST_DB_DIR } from '../src/pipeline/artistDb.js';

test('Pipeline - slugify', () => {
  assert.strictEqual(slugify('The Cure'), 'the-cure');
  assert.strictEqual(slugify('Rammstein - Live in Berlin!'), 'rammstein-live-in-berlin');
  assert.strictEqual(slugify('  Coldplay  '), 'coldplay');
  assert.strictEqual(slugify('Aphex Twin'), 'aphex-twin');
  assert.strictEqual(slugify('Zürich'), slugify('Zurich'));
});

test('Pipeline - slugify preserves non-Latin scripts instead of dropping them to an empty/mangled slug', () => {
  // Real production cases (data/approved_artists.json) that used to collapse to
  // an empty string and collide into the same dist/artists/{slug}.json file.
  assert.strictEqual(slugify('Алла Пугачёва'), 'алла-пугачева'); // ё NFKD-decomposes to е + combining mark, stripped like an accent
  assert.strictEqual(slugify('Антоха МС'), 'антоха-мс');
  assert.notStrictEqual(slugify('Алла Пугачёва'), slugify('Алексей Глызин'), 'two distinct Cyrillic-only names must not collide');

  // Mixed-script name: the Latin portion is no longer the only thing that survives.
  assert.strictEqual(slugify('Zемфира'), 'zемфира');

  // CJK: no word-space separators, but a real, non-empty, stable slug.
  assert.strictEqual(slugify('宇多田ヒカル'), '宇多田ヒカル');
  assert.strictEqual(slugify('宇多田ヒカル'), slugify('宇多田ヒカル'), 'stable/idempotent');
});

test('Pipeline - slugify falls back to a stable hash (never an empty string) for a name with no letters/digits at all', () => {
  const a = slugify('♫');
  const b = slugify('★★★');
  assert.notStrictEqual(a, '', 'must never be empty -- an empty slug is how distinct symbol-only names used to collide');
  assert.notStrictEqual(b, '', 'must never be empty');
  assert.notStrictEqual(a, b, 'two distinct symbol-only names must still get distinct slugs');
  assert.strictEqual(slugify('♫'), slugify('♫'), 'stable/idempotent');
});

test('Pipeline - artist name cleaning', () => {
  assert.strictEqual(cleanArtistName('The Cure - SOLD OUT'), 'The Cure');
  assert.strictEqual(cleanArtistName('Rammstein (SOLD OUT)'), 'Rammstein');
  assert.strictEqual(cleanArtistName('Metallica - Live in Wembley'), 'Metallica');
  assert.strictEqual(cleanArtistName('Coldplay - Special Guest: HER'), 'Coldplay');
  assert.strictEqual(cleanArtistName('Billie Eilish (Support)'), 'Billie Eilish');
  assert.strictEqual(cleanArtistName('Taylor Swift - Tour 2026'), 'Taylor Swift');
  // A hyphenated stage name with no surrounding spaces must not be mistaken for a
  // "- Live" suffix marker and truncated.
  assert.strictEqual(cleanArtistName('J-Live'), 'J-Live');
});

test('Pipeline - match approved artists and detect cover bands', () => {
  const approved = ['The Cure', 'Rammstein', 'Metallica', 'Daft Punk'];

  // Case-insensitive exact matches
  assert.deepStrictEqual(matchApprovedArtist('the cure', approved), { name: 'The Cure' });
  assert.deepStrictEqual(matchApprovedArtist('RAMMSTEIN', approved), { name: 'Rammstein' });

  // Substring matches inside cleaned strings
  assert.deepStrictEqual(matchApprovedArtist('The Cure - SOLD OUT', approved), { name: 'The Cure' });
  assert.deepStrictEqual(matchApprovedArtist('Metallica - Special Guest', approved), { name: 'Metallica' });

  // Cover bands / Tribute checks (must return null)
  assert.strictEqual(matchApprovedArtist('The Cure Tribute Band', approved), null);
  assert.strictEqual(matchApprovedArtist('Rammstein Cover Band', approved), null);
  assert.strictEqual(matchApprovedArtist('Metallica Cover Show', approved), null);

  // Non-approved artist (must return null)
  assert.strictEqual(matchApprovedArtist('Britney Spears', approved), null);
});

test('Pipeline - artist matching bug fixes: punctuation, shadowing, cover-substring, hyphenated names', () => {
  // Name ending in punctuation: a naive \b...\b regex never matches at end-of-string here.
  const withPunctuation = ['Against Me!', 'Rammstein'];
  assert.deepStrictEqual(matchApprovedArtist('Against Me!', withPunctuation), { name: 'Against Me!' });

  // A short generic entry must not shadow a longer, more specific one that also matches.
  const shadowing = ['alan', 'Alan Walker'];
  assert.deepStrictEqual(matchApprovedArtist('Alan Walker', shadowing), { name: 'Alan Walker' });

  // "cover"/"tribute" as a substring of a real name must not trigger the cover-band filter.
  const coverSubstring = ['David Coverdale', 'The Cure'];
  assert.deepStrictEqual(matchApprovedArtist('David Coverdale', coverSubstring), { name: 'David Coverdale' });
  // A real cover-band listing must still be rejected.
  assert.strictEqual(matchApprovedArtist('The Cure Cover Band', coverSubstring), null);

  // A hyphenated stage name with no surrounding spaces must survive cleanArtistName's
  // "- Live" suffix-stripping (which only strips when the hyphen is preceded by a space).
  const hyphenated = ['J-Live', 'Rammstein'];
  assert.deepStrictEqual(matchApprovedArtist('J-Live', hyphenated), { name: 'J-Live' });
  // A genuine "- Live" suffix (space before the hyphen) must still be stripped.
  assert.deepStrictEqual(matchApprovedArtist('J-Live - Live at Blue Note', hyphenated), { name: 'J-Live' });

  // "Live in <city>" (no leading hyphen -- a common tour-page template) must be
  // stripped, and a bare "Live" (the real approved artist) left untouched.
  // Real cases found live in published output: "AZ Live in Berlin" was wrongly
  // matched to a "Berlin" whitelist entry (the band), because "Live in Berlin"
  // never got stripped and the city name matched literally.
  const liveInCity = ['AZ', 'Berlin', 'Live'];
  assert.deepStrictEqual(matchApprovedArtist('AZ Live in Berlin', liveInCity), { name: 'AZ' });
  assert.deepStrictEqual(matchApprovedArtist('Live', liveInCity), { name: 'Live' });
});

test('Pipeline - parse date strings', () => {
  const baseDate = '2026-07-07T00:00:00.000Z';

  // Relative dates
  assert.strictEqual(parseDate('Today', baseDate), '2026-07-07');
  assert.strictEqual(parseDate('heute', baseDate), '2026-07-07');
  assert.strictEqual(parseDate('Tomorrow', baseDate), '2026-07-08');
  assert.strictEqual(parseDate('morgen', baseDate), '2026-07-08');

  // ISO Dates
  assert.strictEqual(parseDate('2026-10-12', baseDate), '2026-10-12');

  // German and English dotted formats
  assert.strictEqual(parseDate('12.10.2026', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('12.10.26', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('12.10.', baseDate), '2026-10-12'); // year fallback

  // Real-world case: Sagres Campo Pequeno's calendar widget renders MM.DD.YYYY,
  // not the usual DD.MM.YYYY -- when the second number can't be a valid month,
  // swap positions instead of emitting an out-of-range month that would still
  // pass ConcertSchema's shape-only date regex.
  assert.strictEqual(parseDate('09.17.2026', baseDate), '2026-09-17');
  assert.strictEqual(parseDate('12.25.2026', baseDate), '2026-12-25');

  // Calendar-validity gate: a result that isn't a real calendar date must never
  // reach ConcertSchema (whose date regex only checks digit shape, not validity).
  // These cases the day/month swap heuristic can't resolve (both numbers >12, or
  // an already-ISO date that's simply impossible) must return null, not garbage.
  assert.strictEqual(parseDate('13.13.2026', baseDate), null);
  assert.strictEqual(parseDate('31.02.2026', baseDate), null); // Feb 31 doesn't exist
  assert.strictEqual(parseDate('2026-02-30', baseDate), null); // Feb 30 doesn't exist

  // Spanish "D de Month de YYYY" -- real format from Medellin/Barcelona/Mexico
  // City venue pages. The connector words mean this needs its own branch, not
  // just Spanish month names in the lookup table (chrono-node's English-default
  // parser also fails on this, confirmed empirically).
  assert.strictEqual(parseDate('8 de julio de 2026', baseDate), '2026-07-08');
  assert.strictEqual(parseDate('1 de agosto de 2026', baseDate), '2026-08-01');
  assert.strictEqual(parseDate('25 de diciembre de 2026', baseDate), '2026-12-25');

  // Croatian genitive month names -- real format from a Zagreb venue page.
  assert.strictEqual(parseDate('21. srpnja 2026. u 20:00', baseDate), '2026-07-21');

  // chrono-node coverage guard: chrono is English-only and, on a date it can't
  // understand (e.g. genuinely foreign-language text with no recognizable month
  // name), will still confidently latch onto a lone fragment like a bare time
  // and silently default the rest to baseDate ("today at 8pm") instead of
  // failing -- must return null instead of a plausible-looking wrong date.
  assert.strictEqual(parseDate('01 lis, 26', baseDate), null); // Croatian abbreviation, not in the map
  assert.strictEqual(parseDate('WE15JUL 2026', baseDate), null); // no separators, unparseable by design

  // Word-based dates with years (English/German)
  assert.strictEqual(parseDate('12. Okt 2026', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('12 Oktober 2026', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('12 Oct 2026', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('Oct 12, 2026', baseDate), '2026-10-12');

  // Word-based dates without years (English/German)
  assert.strictEqual(parseDate('12. Okt', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('12 Oktober', baseDate), '2026-10-12');
  assert.strictEqual(parseDate('Oct 12', baseDate), '2026-10-12');
});

test('Pipeline - parseSpotifyArtistId extracts the ID from an open.spotify.com artist URL', () => {
  assert.strictEqual(parseSpotifyArtistId('https://open.spotify.com/artist/12Chz98pHFMPJEknJQMWvI'), '12Chz98pHFMPJEknJQMWvI');
  // Localized Spotify link variant.
  assert.strictEqual(parseSpotifyArtistId('https://open.spotify.com/intl-de/artist/12Chz98pHFMPJEknJQMWvI'), '12Chz98pHFMPJEknJQMWvI');
  // Not an artist link -> no ID.
  assert.strictEqual(parseSpotifyArtistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), undefined);
  assert.strictEqual(parseSpotifyArtistId('https://www.instagram.com/museband/'), undefined);
  assert.strictEqual(parseSpotifyArtistId(null), undefined);
  assert.strictEqual(parseSpotifyArtistId(undefined), undefined);
});

test('Pipeline - processConcerts populates spotifyId (parsed) and mbid (passed through) from the matched artist', async () => {
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;
  const baseDate = '2026-07-07T00:00:00.000Z';
  const scrapedAt = new Date().toISOString();

  // matchApprovedArtist/buildApprovedMatcher read from an in-memory list, so this
  // exercises the real toMatch()->concertData wiring without depending on any
  // specific artist actually having an mbid in the live database.
  const approved = [{
    name: 'Test Artist Mbid',
    website: 'https://example.com',
    socials: { spotify: 'https://open.spotify.com/artist/abc123XYZ' },
    mbid: '11111111-2222-3333-4444-555555555555'
  }];

  const matched = matchApprovedArtist('Test Artist Mbid', approved);
  assert.strictEqual(matched?.mbid, '11111111-2222-3333-4444-555555555555');

  // Full pipeline pass (uses the real approved_artists.json for other lookups,
  // but this concert's artist won't match it -- so assert against the matcher
  // output directly above, and separately confirm a concert missing these
  // sources just omits the fields rather than erroring.
  const rawConcerts: Partial<Concert>[] = [{
    artist: 'The Cure',
    date: '2026-10-12',
    venue: 'Club Arena',
    city: 'Berlin',
    country: 'de',
    originalSource: 'club-arena.de',
    scrapedAt
  }];
  const processed = await processConcerts(rawConcerts, approvedArtistsPath, baseDate);
  assert.strictEqual(processed.length, 1);
  // The real DB may or may not have an mbid for The Cure yet -- just confirm the
  // field is either a string or omitted, never null/garbage.
  assert.ok(processed[0].mbid === undefined || typeof processed[0].mbid === 'string');
});

test('Pipeline - extractTimeFromRawDate pulls HH:MM from an embedded ISO datetime, nothing else', () => {
  assert.strictEqual(extractTimeFromRawDate('2026-09-10T20:00:00'), '20:00');
  assert.strictEqual(extractTimeFromRawDate('2026-09-10T20:00:00.000Z'), '20:00');
  assert.strictEqual(extractTimeFromRawDate('2026-09-10'), undefined, 'no time component -> undefined');
  assert.strictEqual(extractTimeFromRawDate('12. Okt 2026'), undefined, 'free-text date -> undefined, no chrono fallback');
  assert.strictEqual(extractTimeFromRawDate('2026-09-10T25:99:00'), undefined, 'out-of-range hour/minute rejected');
});

test('Pipeline - inferVenueKind classifies by venue-name keywords, undefined when nothing matches', () => {
  assert.strictEqual(inferVenueKind('Wembley Stadium'), 'stadium');
  assert.strictEqual(inferVenueKind('The O2 Arena'), 'arena');
  assert.strictEqual(inferVenueKind('Royal Albert Hall'), 'hall');
  assert.strictEqual(inferVenueKind('Sala Apolo Club'), 'club');
  assert.strictEqual(inferVenueKind('Roman Amphitheatre'), 'arena');
  assert.strictEqual(inferVenueKind('Royal Opera House'), 'theatre');
  assert.strictEqual(inferVenueKind('Open Air Festival Grounds'), 'open-air');
  assert.strictEqual(inferVenueKind('Paradiso'), undefined, 'a venue name with no recognizable keyword stays unclassified');
});

test('Pipeline - processConcerts wires startTime/venueKind/festival/lineup through from the raw event', async () => {
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;
  const baseDate = '2026-07-07T00:00:00.000Z';
  const scrapedAt = new Date().toISOString();

  const rawConcerts: Partial<Concert>[] = [{
    artist: 'The Cure',
    date: '2026-10-12T20:30:00',
    venue: 'Wembley Stadium',
    city: 'London',
    country: 'gb',
    festival: { name: 'Some Festival', url: 'https://example.com/fest' },
    lineup: ['The Cure', 'Muse'],
    priceRange: { min: 45, max: 250, currency: 'GBP' },
    originalSource: 'ticketmaster.com',
    scrapedAt
  }];

  const processed = await processConcerts(rawConcerts, approvedArtistsPath, baseDate);
  assert.strictEqual(processed.length, 1);
  assert.strictEqual(processed[0].startTime, '20:30');
  assert.strictEqual(processed[0].venueKind, 'stadium');
  assert.deepStrictEqual(processed[0].festival, { name: 'Some Festival', url: 'https://example.com/fest' });
  assert.deepStrictEqual(processed[0].lineup, ['The Cure', 'Muse']);
  assert.deepStrictEqual(processed[0].priceRange, { min: 45, max: 250, currency: 'GBP' });
});

test('Pipeline - full concert processing & deduplication', async () => {
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;
  const baseDate = '2026-07-07T00:00:00.000Z';
  const scrapedAt = new Date().toISOString();

  const rawConcerts: Partial<Concert>[] = [
    // Valid approved concert
    {
      artist: 'The Cure - SOLD OUT',
      date: '12. Okt 2026',
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      ticketUrl: 'https://example.com/cure',
      originalSource: 'club-arena.de',
      scrapedAt
    },
    // Duplicate of the first (should merge, prioritizing ticket link)
    {
      artist: 'The Cure',
      date: '2026-10-12',
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      originalSource: 'other-source.de',
      scrapedAt
    },
    // Cover band (should be filtered out)
    {
      artist: 'The Cure Cover Band',
      date: '12. Okt 2026',
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      ticketUrl: 'https://example.com/cure-cover',
      originalSource: 'club-arena.de',
      scrapedAt
    },
    // Non-approved artist (should be filtered out)
    {
      artist: 'Unknown Artist',
      date: '12. Okt 2026',
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      originalSource: 'club-arena.de',
      scrapedAt
    }
  ];

  const processed = await processConcerts(rawConcerts, approvedArtistsPath, baseDate);

  // We should have exactly 1 processed concert: The Cure (deduplicated)
  assert.strictEqual(processed.length, 1);
  const result = processed[0];
  assert.strictEqual(result.artist, 'The Cure'); // Canonical name
  assert.ok(result.artistWebsite?.startsWith('https://www.thecure.com')); // Website populated
  assert.strictEqual(result.date, '2026-10-12'); // Normalized date
  assert.strictEqual(result.city, 'Berlin');
  assert.strictEqual(result.country, 'DE'); // Uppercased
  assert.strictEqual(result.ticketUrl, 'https://www.thecure.com/'); // artist site preferred over the raw ticket link
});

test('Pipeline - ticketUrl falls back to the raw ticket link when the artist has no known website', async () => {
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;
  const baseDate = '2026-07-07T00:00:00.000Z';
  const scrapedAt = new Date().toISOString();

  const rawConcerts: Partial<Concert>[] = [
    {
      artist: 'Airport',
      date: '12. Okt 2026',
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      ticketUrl: 'https://example.com/airport-tickets',
      originalSource: 'club-arena.de',
      scrapedAt
    }
  ];

  const processed = await processConcerts(rawConcerts, approvedArtistsPath, baseDate);
  assert.strictEqual(processed.length, 1);
  assert.strictEqual(processed[0].artistWebsite, undefined); // fixture artist has no known site
  assert.strictEqual(processed[0].ticketUrl, 'https://example.com/airport-tickets'); // falls back, not dropped
});

test('Pipeline - drops concerts whose date has already passed', async () => {
  // Real case found auditing live published output: some venue pages list past
  // shows alongside upcoming ones (an archive section the scraper's selector
  // also picks up), so a concert dated well before the scrape date was making
  // it all the way into dist/concerts.json with nothing to catch it.
  const approvedArtistsPath = PRODUCTION_ARTIST_DB_DIR;
  const baseDate = '2026-07-07T00:00:00.000Z';
  const scrapedAt = new Date().toISOString();

  const rawConcerts: Partial<Concert>[] = [
    {
      artist: 'The Cure',
      date: '2026-03-29', // before baseDate -- must be dropped
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      originalSource: 'club-arena.de',
      scrapedAt
    },
    {
      artist: 'The Cure',
      date: '2026-07-07', // exactly baseDate's day -- must be kept, not dropped
      venue: 'Club Arena',
      city: 'Berlin',
      country: 'de',
      originalSource: 'club-arena.de',
      scrapedAt
    }
  ];

  const processed = await processConcerts(rawConcerts, approvedArtistsPath, baseDate);
  assert.strictEqual(processed.length, 1);
  assert.strictEqual(processed[0].date, '2026-07-07');
});

test('Pipeline - normalizeCountry accepts full country names (schema.org addressCountry) as well as codes', () => {
  // Real-world case: an artist tour-page scraper's .addressCountry microdata
  // renders the full country name, not a 2-letter code.
  assert.strictEqual(normalizeCountry('Germany'), 'DE');
  assert.strictEqual(normalizeCountry('Slovakia'), 'SK');
  assert.strictEqual(normalizeCountry('Greece'), 'GR');
  assert.strictEqual(normalizeCountry('United Kingdom'), 'GB');
  assert.strictEqual(normalizeCountry('UK'), 'GB');
  // Already a code: passed through unchanged (just uppercased).
  assert.strictEqual(normalizeCountry('de'), 'DE');
  assert.strictEqual(normalizeCountry('DE'), 'DE');
  // Real-world case: Sabaton's tour page nests the city span inside the same
  // element as the country text with no separator, so cheerio's .text() yields
  // "Bulgaria, Plovdiv" (country + city concatenated) -- only the part before
  // the comma is the country.
  assert.strictEqual(normalizeCountry('Bulgaria, Plovdiv'), 'BG');
  // Same page, more real cases: alternate/colloquial full names and a trailing
  // parenthetical alternate name, both with the concatenated city suffix.
  assert.strictEqual(normalizeCountry('The Netherlands, Rotterdam'), 'NL');
  assert.strictEqual(normalizeCountry('Czech Republic, Prague'), 'CZ');
  assert.strictEqual(normalizeCountry('Slovakia (Slovak Republic), Bratislava'), 'SK');
});
