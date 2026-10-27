import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildApprovedMatcher, processConcerts, slugify } from '../src/pipeline/process.js';
import { projectArtistIdentities } from '../src/pipeline/artist_identity.js';
import { DEFAULT_MAX_FUTURE_DAYS, occurrenceDedupeKeys, publicationMaxFutureDays,
  publicationQualityDropReason, sourceActionUrl } from '../src/pipeline/publication_quality.js';
import { publishArtistCatalog, publishConcerts } from '../src/generator/publish.js';
import { loadDenylistGuard } from '../src/pipeline/denylist.js';
import type { Concert, RawConcert } from '../src/schemas/concert.js';
import type { ProcessingDiagnostics } from '../src/observability/processing_diagnostics.js';

const BASE = '2026-10-27T00:00:00.000Z';
const cohorts = [
  { names: ['A. R. Rahman', 'A.R. Rahman', 'A.R.Rahman'], mbid: 'e0bba708-bdd3-478d-84ea-c706413bedab',
    spotify: '1mYsTxnqsietFxj1OgoGbG', website: 'https://www.arrahman.com/' },
  { names: ['AURORA', 'Aurora Aksnes'], mbid: '484a4e90-6899-4e4b-a948-a2255d365340',
    spotify: '1WgXqy2Dd70QQOU7Ay074N', website: 'http://www.aurora-music.com/' },
  { names: ['KoRn', 'KoЯn'], mbid: 'ac865b2e-bba8-4f5a-8756-dd40d5e39f46',
    spotify: '3RNrq3jvMZxD9ZyoOZbQOD', website: 'https://kornofficial.com/' }
];
const artists = cohorts.flatMap(c => c.names.map(name => ({ name, mbid: c.mbid, website: c.website,
  socials: { spotify: `https://open.spotify.com/artist/${c.spotify}` } })));
function row(overrides: RawConcert = {}): Concert & RawConcert {
  return { artist: 'AURORA', date: '2026-11-21', city: 'Berlin', country: 'DE', venue: 'Arena',
    originalSource: 'source.example', scrapedAt: '2026-10-27T10:00:00.000Z', ...overrides };
}
async function withDb(fn: (db: string, dir: string) => Promise<void>, dbArtists: any[] = artists) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-integrity-'));
  try {
    const db = path.join(dir, 'db.json');
    await fs.writeFile(db, JSON.stringify(dbArtists));
    await fn(db, dir);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('source actions and event provenance survive enrichment, unknown and unsafe links stay absent', async () => {
  await withDb(async db => {
    const rich = row({ sourceEventUrl: ' https://venue.example/events/123 ',
      ticketUrl: ' https://tickets.example/buy/123 ', startTime: '20:00', priceRange: { min: 10, max: 30, currency: 'EUR' } });
    const [event] = await processConcerts([rich], db, BASE);
    assert.equal(event.ticketUrl, 'https://tickets.example/buy/123');
    assert.equal(event.eventUrl, 'https://venue.example/events/123');
    assert.equal(event.artistWebsite, 'http://www.aurora-music.com/');
    for (const field of ['startTime', 'priceRange', 'originalSource', 'scrapedAt'] as const) assert.deepEqual(event[field], rich[field]);
    assert.equal('sourceEventUrl' in event, false);
    for (const bad of [undefined, '', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pass@host.test/show', '/relative']) {
      const [unlinked] = await processConcerts([row({ ticketUrl: bad, sourceEventUrl: bad })], db, BASE);
      assert.equal(unlinked.ticketUrl, undefined);
      assert.equal(unlinked.eventUrl, undefined);
      assert.equal(unlinked.artistWebsite, 'http://www.aurora-music.com/');
    }
    const [fallback] = await processConcerts([row({ sourceEventUrl: 'javascript:bad', eventUrl: 'https://venue.example/show' })], db, BASE);
    assert.equal(fallback.eventUrl, 'https://venue.example/show');
    assert.equal(sourceActionUrl('http://tickets.example/show'), 'http://tickets.example/show');
  });
});

test('only the evidence-backed named cohorts collapse; metadata input is immutable and names stay searchable', () => {
  const before = JSON.stringify(artists);
  const projection = projectArtistIdentities(artists);
  assert.equal(projection.artists.length, 3);
  assert.deepEqual(projection.conflicts, []);
  const match = buildApprovedMatcher(artists);
  for (const cohort of cohorts) for (const name of cohort.names) assert.equal(match(name)?.name, cohort.names[0]);
  assert.equal(JSON.stringify(artists), before);
  const projects = [{ name: 'Project One', mbid: 'shared', socials: { spotify: 'https://open.spotify.com/artist/shared' } },
    { name: 'Project Two', mbid: 'shared', socials: { spotify: 'https://open.spotify.com/artist/shared' } }];
  assert.equal(projectArtistIdentities(projects).artists.length, 2);
  assert.equal(buildApprovedMatcher(projects)('Project Two')?.name, 'Project Two');
});

test('conflicting IDs/sites and uncorroborated alias rows block an entire cohort', () => {
  for (const conflict of [{ mbid: 'different' }, { socials: { spotify: 'https://open.spotify.com/artist/other' } },
    { website: 'https://unrelated.example/' }, { mbid: undefined, socials: undefined }]) {
    const input = [artists[3], { ...artists[4], ...conflict }];
    const projection = projectArtistIdentities(input);
    assert.equal(projection.artists.length, 2);
    assert.deepEqual(projection.conflicts, ['AURORA']);
    assert.equal(projection.compatibilityNames.size, 0);
    assert.equal(buildApprovedMatcher(input)('Aurora Aksnes')?.name, 'Aurora Aksnes');
  }
  assert.equal(projectArtistIdentities(['AURORA', 'Aurora Aksnes']).artists.length, 2);
});

test('canonical catalog, master feed, autocomplete aliases and legacy per-artist endpoints agree', async () => {
  await withDb(async (db, dir) => {
    const events = await processConcerts(artists.map(a => row({ artist: a.name })), db, BASE);
    assert.equal(events.length, 3);
    const out = path.join(dir, 'out');
    await publishConcerts(events, out, artists);
    await publishArtistCatalog(artists, out);
    const read = async (file: string) => JSON.parse(await fs.readFile(path.join(out, file), 'utf8'));
    const catalog = await read('artists.json');
    assert.equal(catalog.length, 3);
    const index = await read('index.json');
    assert.equal(index.stats.uniqueArtists, 3);
    assert.equal(index.schemaVersion, 3);
    assert.equal((await read('concerts.json')).length, 3);
    for (const c of cohorts) {
      const entry = catalog.find((a: any) => a.name === c.names[0]);
      const canonical = await read(`artists/${entry.slug}.json`);
      assert.equal(canonical.length, 1);
      for (const alias of c.names.slice(1)) {
        assert.ok(entry.aliases.includes(alias));
        assert.ok(entry.legacySlugs.includes(slugify(alias)));
        assert.equal(index.artistAliases[slugify(alias)], entry.slug);
        assert.deepEqual(await read(`artists/${slugify(alias)}.json`), canonical);
      }
    }
    // Compatibility files are pruned with the canonical artist, never linger.
    await publishConcerts([], out, artists);
    assert.deepEqual(await fs.readdir(path.join(out, 'artists')), []);
  });
});

test('distinct countries, venues and showtimes survive, sparse rows cannot bridge known shows', async () => {
  const input = [row({ startTime: '18:00' }), row({ startTime: '21:00' }), row(),
    row({ venue: 'Other Arena', startTime: '18:00' }), row({ country: 'US', startTime: '18:00' })];
  const keys = occurrenceDedupeKeys(input);
  assert.equal(new Set(keys).size, 5);
  await withDb(async db => {
    for (const rows of [input, [...input].reverse()]) {
      const events = await processConcerts(rows, db, BASE);
      assert.equal(events.length, 5);
      assert.equal(events.filter(c => c.startTime === '18:00').length, 3);
    }
    const [complete] = await processConcerts([row(), row({ startTime: '20:00', lat: 52, lng: 13 })], db, BASE);
    assert.equal(complete.startTime, '20:00');
    assert.equal(complete.lat, 52);
  });
});

test('planning horizon and malformed/non-artist exclusion are observable, configurable and preserve inputs', async () => {
  assert.equal(DEFAULT_MAX_FUTURE_DAYS, 730);
  assert.equal(publicationQualityDropReason('2028-10-26', BASE, 730), undefined);
  assert.equal(publicationQualityDropReason('2028-10-27', BASE, 730), 'beyondPlanningHorizon');
  assert.equal(publicationQualityDropReason('2028-02-29', BASE, 730), undefined);
  assert.equal(publicationQualityDropReason('2027-02-29', BASE, 730), 'badDate');
  for (const invalid of [0, -1, 1.5, '', 'abc']) assert.throws(() => publicationMaxFutureDays(invalid));
  const input = [row(), row({ artist: 'pop-rock', date: '2039-01-01' }),
    row({ artist: 'Lady Gaga', city: 'Barcelona', country: 'US', date: '2029-10-28' }), row({ date: '2027-02-30' })];
  const before = JSON.stringify(input);
  await withDb(async db => {
    let report: ProcessingDiagnostics | undefined;
    const events = await processConcerts(input, db, BASE, undefined, r => { report = r; });
    assert.equal(events.length, 1);
    assert.equal(report!.dropped.nonArtist, 1);
    assert.equal(report!.dropped.beyondPlanningHorizon, 1);
    assert.equal(report!.dropped.badDate, 1);
    assert.ok(report!.samples.some(s => s.artist === 'Lady Gaga' && s.date === '2029-10-28' && s.country === 'US'));
    for (const counts of [report!, ...Object.values(report!.sources)]) {
      assert.equal(counts.rawCount, counts.publishedCount + counts.duplicatesMerged + Object.values(counts.dropped).reduce((a, b) => a + b, 0));
    }
    const later = await processConcerts([input[2]], db, BASE, undefined, undefined, undefined, { maxFutureDays: 2000 });
    assert.equal(later.length, 1, 'explicitly widening the planning window retains the original date/location, not a fabricated repair');
    assert.equal(later[0].date, '2029-10-28');
    assert.equal(later[0].country, 'US');
  }, [...artists, { name: 'pop-rock' }, { name: 'Lady Gaga' }]);
  assert.equal(JSON.stringify(input), before);
});

test('denylist is exact and explicit target exemptions remain intact; catalog excludes genre placeholders', async () => {
  await withDb(async (_db, dir) => {
    const data = path.join(dir, 'data');
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'artist_denylist.json'), JSON.stringify({ terms: ['pop-rock', 'jazz'] }));
    await fs.writeFile(path.join(data, 'artist_scrape_targets.txt'), 'pop-rock\n');
    const guard = await loadDenylistGuard(dir);
    assert.equal(guard.isDenylisted('pop-rock'), false);
    assert.equal(guard.isDenylisted('jazz'), true);
    assert.equal(guard.isDenylisted('Jazz Sabbath'), false);
    await publishArtistCatalog([{ name: 'pop-rock' }, { name: 'Jazz Sabbath', aliases: ['pop-rock', 'Sabbath Jazz'], similarArtists: [{ name: 'pop-rock', slug: 'pop-rock', match: 1 }] }], path.join(dir, 'out'));
    const catalog = JSON.parse(await fs.readFile(path.join(dir, 'out', 'artists.json'), 'utf8'));
    assert.deepEqual(catalog.map((a: any) => a.name), ['Jazz Sabbath']);
    assert.deepEqual(catalog[0].aliases, ['Sabbath Jazz']);
    assert.equal(catalog[0].similarArtists, undefined);
  });
});

test('formatting-equivalent names need shared identity and reject every stable-ID conflict', () => {
  const input = [{ name: 'Test.Band', mbid: 'same', socials: { spotify: 'https://open.spotify.com/artist/same' } },
    { name: 'Test Band', mbid: 'same', socials: { spotify: 'https://open.spotify.com/artist/same' } }];
  const projection = projectArtistIdentities(input);
  assert.equal(projection.artists.length, 1);
  assert.equal(buildApprovedMatcher(input)('Test.Band')?.name, buildApprovedMatcher(input)('Test Band')?.name);
  for (const conflict of [{ mbid: 'other' }, { socials: { spotify: 'https://open.spotify.com/artist/other' } },
    { website: 'https://another.example' }, { mbid: undefined, socials: undefined }]) {
    const guarded = [{ ...input[0], website: 'https://band.example' }, { ...input[1], ...conflict }];
    assert.equal(projectArtistIdentities(guarded).artists.length, 2);
    assert.deepEqual(projectArtistIdentities(guarded).conflicts, ['format:testband']);
  }
  const separateProjects = [{ ...input[0], name: 'Another Project' }, input[1]];
  assert.equal(projectArtistIdentities(separateProjects).artists.length, 2);
  const noIds = [{ name: 'Test.Band' }, { name: 'Test Band' }];
  assert.equal(projectArtistIdentities(noIds).artists.length, 2);
  assert.equal(projectArtistIdentities([...input].reverse()).artists[0].name, projection.artists[0].name);
});

test('formatting projection leaves ambiguous single-ID projects apart even with copied sites', () => {
  for (const names of [['Attack Attack!', 'Attack! Attack!'], ['8 Ball', '8-Ball']]) {
    const rows = names.map(name => ({ name, website: 'https://copied.example/',
      socials: { spotify: 'https://open.spotify.com/artist/copied' } }));
    assert.equal(projectArtistIdentities(rows).artists.length, 2);
  }
  const relatedOnlyByAlias = [{ ...artists[5], name: 'Side Project', aliases: ['KoRn'] }, artists[5]];
  assert.equal(projectArtistIdentities(relatedOnlyByAlias).artists.length, 2);
  assert.equal(buildApprovedMatcher(relatedOnlyByAlias)('Side Project')?.name, 'Side Project');
});


test('the planning policy is recorded and exact historical venue exclusions cannot spread to other shows', async () => {
  await withDb(async db => {
    let report: ProcessingDiagnostics | undefined;
    await processConcerts([row()], db, BASE, undefined, r => { report = r; }, undefined, { maxFutureDays: 365 });
    assert.deepEqual(report?.publicationPolicy, { maxFutureDays: 365 });
  });
  await withDb(async db => {
    const bad = row({ artist: 'Beth Hart', date: '2026-11-21', venue: 'Swiss Life Hall', city: 'Hannover',
      country: 'DE', originalSource: 'bandsintown.com' });
    const kept = await processConcerts([bad, { ...bad, date: '2026-11-22' }, { ...bad, venue: 'Another Hall' },
      { ...bad, originalSource: 'venue.example' }, { ...bad, city: 'Another City' }], db, BASE);
    assert.equal(kept.length, 4);
    assert.ok(!kept.some(r => r.date === bad.date && r.city === bad.city && r.venue === bad.venue && r.originalSource === bad.originalSource));
  }, [{ name: 'Beth Hart' }]);
});
