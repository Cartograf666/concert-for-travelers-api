import test from 'node:test';
import assert from 'node:assert';
import { slugify, cleanArtistName, matchApprovedArtist, parseDate, processConcerts } from '../src/pipeline/process.js';
import { Concert } from '../src/schemas/concert.js';
import * as path from 'path';

test('Pipeline - slugify', () => {
  assert.strictEqual(slugify('The Cure'), 'the-cure');
  assert.strictEqual(slugify('Rammstein - Live in Berlin!'), 'rammstein-live-in-berlin');
  assert.strictEqual(slugify('  Coldplay  '), 'coldplay');
  assert.strictEqual(slugify('Aphex Twin'), 'aphex-twin');
});

test('Pipeline - artist name cleaning', () => {
  assert.strictEqual(cleanArtistName('The Cure - SOLD OUT'), 'The Cure');
  assert.strictEqual(cleanArtistName('Rammstein (SOLD OUT)'), 'Rammstein');
  assert.strictEqual(cleanArtistName('Metallica - Live in Wembley'), 'Metallica');
  assert.strictEqual(cleanArtistName('Coldplay - Special Guest: HER'), 'Coldplay');
  assert.strictEqual(cleanArtistName('Billie Eilish (Support)'), 'Billie Eilish');
  assert.strictEqual(cleanArtistName('Taylor Swift - Tour 2026'), 'Taylor Swift');
});

test('Pipeline - match approved artists and detect cover bands', () => {
  const approved = ['The Cure', 'Rammstein', 'Metallica', 'Daft Punk'];

  // Case-insensitive exact matches
  assert.strictEqual(matchApprovedArtist('the cure', approved), 'The Cure');
  assert.strictEqual(matchApprovedArtist('RAMMSTEIN', approved), 'Rammstein');

  // Substring matches inside cleaned strings
  assert.strictEqual(matchApprovedArtist('The Cure - SOLD OUT', approved), 'The Cure');
  assert.strictEqual(matchApprovedArtist('Metallica - Special Guest', approved), 'Metallica');

  // Cover bands / Tribute checks (must return null)
  assert.strictEqual(matchApprovedArtist('The Cure Tribute Band', approved), null);
  assert.strictEqual(matchApprovedArtist('Rammstein Cover Band', approved), null);
  assert.strictEqual(matchApprovedArtist('Metallica Cover Show', approved), null);
  
  // Non-approved artist (must return null)
  assert.strictEqual(matchApprovedArtist('Britney Spears', approved), null);
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

test('Pipeline - full concert processing & deduplication', async () => {
  const approvedArtistsPath = path.join(process.cwd(), 'data', 'approved_artists.json');
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
  assert.strictEqual(result.date, '2026-10-12'); // Normalized date
  assert.strictEqual(result.city, 'Berlin');
  assert.strictEqual(result.country, 'DE'); // Uppercased
  assert.strictEqual(result.ticketUrl, 'https://example.com/cure'); // Ticket URL retained
});
