import test from 'node:test';
import assert from 'node:assert';
import {
  classifyReach, nameMatches, verifyEntry, applyVerdicts, resolverHealthy,
  isInfraHost, publicResolverAgreesNxdomain, hostKillRateBreaker, type VerifyResult,
  type FetchFn, type JudgeFn, type FetchResult
} from '../src/pipeline/verify_enrichment.js';
import type { ArtistEntry } from '../src/schemas/artist.js';

// Route a mock fetch by URL substring to canned results.
function mockFetch(routes: Array<[RegExp, FetchResult]>): FetchFn {
  return async (url) => {
    for (const [re, res] of routes) if (re.test(url)) return res;
    return { status: 0, error: 'dns' }; // default: dead
  };
}
const OK = (body = '<title>page</title>'): FetchResult => ({ status: 200, finalUrl: 'https://x', body });
const DNS_DEAD: FetchResult = { status: 0, error: 'dns' };
const HTTP_404: FetchResult = { status: 404 };
const BLOCKED: FetchResult = { status: 403 };
const TIMEOUT: FetchResult = { status: 0, error: 'timeout' };

const noJudge: JudgeFn = async () => ({});

test('classifyReach buckets', () => {
  assert.strictEqual(classifyReach({ status: 0, error: 'dns' }), 'dead');
  assert.strictEqual(classifyReach({ status: 404 }), 'dead');
  assert.strictEqual(classifyReach({ status: 403 }), 'blocked');
  assert.strictEqual(classifyReach({ status: 0, error: 'timeout' }), 'unreachable');
  assert.strictEqual(classifyReach({ status: 200 }), 'ok');
});

test('nameMatches: token overlap and short-name fallback', () => {
  assert.ok(nameMatches('Jon Hassell', 'Official site of JON HASSELL, trumpeter'));
  assert.ok(!nameMatches('Jon Hassell', 'Buy cheap domains here — parked'));
  assert.ok(nameMatches('M83', 'M83 — official'));
});

test('dead website (DNS) is nulled; spotify oembed 404 is nulled (the Pavel Ku case)', async () => {
  const entry: ArtistEntry = {
    name: 'Pavel Ku',
    website: 'https://pavelku.com/',
    tourUrl: 'https://pavelku.com/events',
    socials: { spotify: 'https://open.spotify.com/artist/55u3Qh7V0Rk0g60nJpD5F3', instagram: 'https://instagram.com/pavelku' }
  };
  const fetchFn = mockFetch([
    [/pavelku\.com/, DNS_DEAD],
    [/oembed/, HTTP_404],
    [/instagram/, OK()]
  ]);
  const res = await verifyEntry(entry, fetchFn, noJudge);
  assert.deepStrictEqual(res.nulledFields.sort(), ['spotify', 'tourUrl', 'website']);
  const updated = applyVerdicts(entry, res, '2026-07-24T00:00:00Z');
  assert.strictEqual(updated.website, null);
  assert.strictEqual(updated.tourUrl, null);
  assert.strictEqual(updated.socials!.spotify, null);
  assert.strictEqual(updated.socials!.instagram, 'https://instagram.com/pavelku'); // reachable social kept
  assert.strictEqual((updated as any).verifiedAt, '2026-07-24T00:00:00Z');
});

test('live website with grounded LLM match is kept; mismatch is nulled', async () => {
  const base: ArtistEntry = { name: 'Some Artist', website: 'https://some-artist.com/' };
  const fetchFn = mockFetch([[/some-artist\.com/, OK('<title>Some Artist official</title>')]]);

  const matchRes = await verifyEntry(base, fetchFn, async (items) => ({ [items[0].url]: 'match' }));
  assert.strictEqual(matchRes.changed, false);

  const mismatchRes = await verifyEntry(base, fetchFn, async (items) => ({ [items[0].url]: 'mismatch' }));
  assert.deepStrictEqual(mismatchRes.nulledFields, ['website']);
});

test('blocked (403) and timeout links are KEPT — infra is not proof of bad data', async () => {
  const entry: ArtistEntry = { name: 'A', website: 'https://blocked.com/', tourUrl: 'https://slow.com/tour' };
  const fetchFn = mockFetch([[/blocked\.com/, BLOCKED], [/slow\.com/, TIMEOUT]]);
  const res = await verifyEntry(entry, fetchFn, noJudge);
  assert.strictEqual(res.changed, false);
  assert.strictEqual(res.verdicts.find((v) => v.field === 'website')!.action, 'keep');
  assert.strictEqual(res.verdicts.find((v) => v.field === 'tourUrl')!.action, 'keep');
});

test('same-host tourUrl inherits the website identity verdict (no extra judge call)', async () => {
  const entry: ArtistEntry = { name: 'B', website: 'https://b.com/', tourUrl: 'https://b.com/shows' };
  const fetchFn = mockFetch([[/b\.com/, OK('<title>B</title>')]]);
  let judgeCalls = 0;
  const judge: JudgeFn = async (items) => { judgeCalls++; return { [items[0].url]: 'mismatch' }; };
  const res = await verifyEntry(entry, fetchFn, judge);
  assert.strictEqual(judgeCalls, 1, 'only website is judged; tourUrl inherits');
  assert.deepStrictEqual(res.nulledFields.sort(), ['tourUrl', 'website'], 'both nulled via one verdict');
});

test('spotify oembed name mismatch is nulled deterministically (no LLM)', async () => {
  const entry: ArtistEntry = { name: 'Real Band', socials: { spotify: 'https://open.spotify.com/artist/0123456789abcdefghijAB' } };
  const fetchFn = mockFetch([[/oembed/, { status: 200, body: JSON.stringify({ title: 'Totally Different Act' }) }]]);
  const res = await verifyEntry(entry, fetchFn, noJudge);
  assert.deepStrictEqual(res.nulledFields, ['spotify']);
});

test('resolverHealthy gate: healthy majority passes, ENOTFOUND storm fails', async () => {
  const allOk = async () => ({ address: '1.2.3.4' });
  const allFail = async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); };
  assert.strictEqual(await resolverHealthy(['a', 'b', 'c', 'd'], allOk), true);
  assert.strictEqual(await resolverHealthy(['a', 'b', 'c', 'd'], allFail), false);
  // One control down of four -> still healthy (majority resolves).
  let n = 0;
  const oneDown = async () => (n++ === 0 ? Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })) : { address: '1.2.3.4' });
  assert.strictEqual(await resolverHealthy(['a', 'b', 'c', 'd'], oneDown), true);
});

test('dead social (404) nulled; malformed spotify id nulled', async () => {
  const entry: ArtistEntry = { name: 'C', socials: { spotify: 'https://open.spotify.com/artist/TOO-SHORT', facebook: 'https://fb.com/dead', youtube: 'https://youtube.com/live' } };
  const fetchFn = mockFetch([[/youtube/, OK()], [/fb\.com/, HTTP_404]]);
  const res = await verifyEntry(entry, fetchFn, noJudge);
  assert.ok(res.nulledFields.includes('facebook'));
  assert.ok(res.nulledFields.includes('spotify')); // malformed id, never even fetched
  assert.ok(!res.nulledFields.includes('youtube'));
});

// ---------------------------------------------------------------------------
// Regression: the 2026-08-04 mass-null incident (350 live links destroyed by a
// VPN resolver that returned NXDOMAIN for www.facebook.com / www.instagram.com /
// www.youtube.com while every control domain resolved normally).
// ---------------------------------------------------------------------------

test('platform hosts are never DNS-dead: an NXDOMAIN-ing resolver cannot null socials', async () => {
  for (const h of ['www.facebook.com', 'm.facebook.com', 'www.instagram.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be', 'open.spotify.com', 't.me', 'vk.com']) {
    assert.equal(isInfraHost(h), true, `${h} must be treated as an always-exists host`);
  }
  // ...but a per-artist domain is still eligible to be declared dead.
  for (const h of ['keijihaino.com', 'www.8-ball.jp', 'halwellband.com']) {
    assert.equal(isInfraHost(h), false, `${h} must remain DNS-checkable`);
  }
});

test('an NXDOMAIN is only believed when a public resolver agrees', async () => {
  // Public resolver sees the host -> the local resolver was lying -> not dead.
  assert.equal(await publicResolverAgreesNxdomain('anything', []).catch(() => false), false);
});

test('nameMatches: identical non-Latin names match (previously nulled as a mismatch)', () => {
  for (const n of ['Аквариум', '坂本龍一', '방탄소년단', 'Ελευθερία Αρβανιτάκη', 'ヨルシカ', '嵐']) {
    assert.equal(nameMatches(n, n), true, `${n} must match itself`);
  }
});

test('nameMatches: diacritic and spacing variants are the same artist', () => {
  assert.equal(nameMatches('Bjork', 'Björk'), true);
  assert.equal(nameMatches('Björk', 'Bjork'), true);
  assert.equal(nameMatches('Han Sunhwa', 'Han Sun Hwa'), true);
  assert.equal(nameMatches('Motorhead', 'Motörhead'), true);
  // A genuinely different artist must still be reported as a mismatch.
  assert.equal(nameMatches('Hannah Montana', 'Ashley O'), false);
});

test('hostKillRateBreaker trips on a host killed ~universally, stays silent on a plausible one', () => {
  const mk = (host: string, n: number, kills: number): VerifyResult => ({
    name: 'x', changed: true, nulledFields: [],
    verdicts: Array.from({ length: n }, (_, i) => ({
      field: 'facebook' as const,
      url: `https://${host}/a${i}`,
      reach: 'dead' as const,
      action: (i < kills ? 'null' : 'keep') as 'null' | 'keep'
    }))
  });
  // The incident's shape: 151/151 facebook.
  assert.equal(hostKillRateBreaker([mk('www.facebook.com', 151, 151)]).length, 1);
  // A legitimate hallucination rate on a heavily-used host: 71/175 spotify.
  assert.deepEqual(hostKillRateBreaker([mk('open.spotify.com', 175, 71)]), []);
  // Below the observation floor: a 2/2 per-artist domain proves nothing either way.
  assert.deepEqual(hostKillRateBreaker([mk('halwellband.com', 2, 2)]), []);
});

test('applyVerdicts stamps verifyTriedAt (not verifiedAt) when nothing was conclusive', () => {
  const entry = { name: 'A', website: 'https://a.example', socials: {} } as ArtistEntry;
  const inconclusive: VerifyResult = {
    name: 'A', changed: false, nulledFields: [],
    verdicts: [{ field: 'website', url: 'https://a.example', reach: 'unreachable', action: 'keep' }]
  };
  const out = applyVerdicts(entry, inconclusive, '2026-08-04T00:00:00.000Z') as any;
  assert.equal(out.verifiedAt, undefined, 'a run that reached nothing must not claim the artist is verified');
  assert.equal(out.verifyTriedAt, '2026-08-04T00:00:00.000Z');
  assert.equal(out.website, 'https://a.example');
});

test('a spotify title matching an ALIAS is not a mismatch', async () => {
  const oembed = (title: string): FetchFn => async () => ({ status: 200, body: JSON.stringify({ title }) });
  const noJudge: JudgeFn = async () => ({});

  // Spotify romanises the name differently from the DB; the alias reconciles them.
  const entry = {
    name: 'Ham Eun-jeong',
    aliases: ['Eunjung', 'Eun Jung', 'Ham Eunjeong'],
    socials: { spotify: 'https://open.spotify.com/artist/7Ek3oOUVLuhonVO3p5SVyy' }
  } as ArtistEntry;
  const ok = await verifyEntry(entry, oembed('Eun Jung'), noJudge);
  assert.deepEqual(ok.nulledFields, [], 'an alias match must never null the link');

  // A title matching neither the name nor any alias is still a real mismatch.
  const bad = await verifyEntry(entry, oembed('Nine Inch Nails'), noJudge);
  assert.deepEqual(bad.nulledFields, ['spotify']);

  // No aliases recorded -> behaviour is unchanged.
  const bare = { name: 'Hannah Montana', socials: { spotify: 'https://open.spotify.com/artist/14scxEoUN7Dcx1m4EQ7oHe' } } as ArtistEntry;
  assert.deepEqual((await verifyEntry(bare, oembed('Ashley O'), noJudge)).nulledFields, ['spotify']);
});
