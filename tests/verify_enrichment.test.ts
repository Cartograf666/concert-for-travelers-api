import test from 'node:test';
import assert from 'node:assert';
import {
  classifyReach, nameMatches, verifyEntry, applyVerdicts, resolverHealthy,
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
