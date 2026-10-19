/** Offline affected-cohort replay. See docs/ru-data-measurement-20261016.md. */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { mock } from 'node:test';
import assert from 'node:assert/strict';

type Row = Record<string, any>;
interface ResponseInput {
  url: string; body: string; sha256: string; status: number;
  capturedAt: string; headers?: Record<string, string>;
  wireBody?: string; wireSha256?: string;
}
interface SourceInput { configPath: string; responses: ResponseInput[]; savedRaw?: string }
interface Inputs {
  clock: string; label: string; sources: SourceInput[];
  baseRevision?: string; candidateRevision?: string;
}
export function validateReplayInputs(inputs: Inputs) {
  assert.ok(inputs.label && inputs.sources.length, 'Nonempty labelled captured cohort required');
  const clock = Date.parse(inputs.clock);
  assert.ok(Number.isFinite(clock), 'Valid frozen clock required');
  for (const revision of [inputs.baseRevision, inputs.candidateRevision]) {
    if (revision !== undefined) assert.match(revision, /^[a-f0-9]{40}$/, 'Exact full revision required');
  }
  for (const source of inputs.sources) for (const response of source.responses) {
    assert.ok(Number.isFinite(Date.parse(response.capturedAt)) && Date.parse(response.capturedAt) <= clock,
      `Frozen clock must not precede capture: ${response.url}`);
  }
  // Existing first-slice manifests keep their immutable base contract.
  return inputs.baseRevision ?? '6af49b13628cd0eeb728f16d62bdaaa17a94e069';
}
const COUNTRIES = 'TR RU TH RS ID AE AM CN KZ VN GE EG CY BY UZ ME'.split(' ');
// Exact aliases only. District/island/metro membership is deliberately not inferred.
const CITY_ALIASES: Record<string, Record<string, string[]>> = {
  TR: { Antalya: ['Antalya', 'Анталья'], Alanya: ['Alanya', 'Аланья'], Istanbul: ['Istanbul', 'İstanbul', 'İstanbul', 'Стамбул'] },
  RU: { Sochi: ['Sochi', 'Сочи'], Moscow: ['Moscow', 'Москва'], 'Saint Petersburg': ['Saint Petersburg', 'St Petersburg', 'Санкт-Петербург'] },
  TH: { Bangkok: ['Bangkok', 'Бангкок'], Phuket: ['Phuket', 'Пхукет'], Pattaya: ['Pattaya', 'Muang Pattaya', 'Паттайя'] },
  RS: { Belgrade: ['Belgrade', 'Beograd', 'Белград'] },
  ID: { Bali: ['Bali', 'Бали'], Denpasar: ['Denpasar', 'Денпасар'], Canggu: ['Canggu', 'Чангу'], Jakarta: ['Jakarta', 'Джакарта'] },
  AE: { Dubai: ['Dubai', 'Дубай'], 'Abu Dhabi': ['Abu Dhabi', 'Абу-Даби'] },
  AM: { Yerevan: ['Yerevan', 'Երևան', 'Ереван'] },
  CN: { Beijing: ['Beijing', 'Пекин'], Shanghai: ['Shanghai', 'Шанхай'], Sanya: ['Sanya', 'Санья'] },
  KZ: { Almaty: ['Almaty', 'Алматы'], Astana: ['Astana', 'Астана'] },
  VN: { 'Da Nang': ['Da Nang', 'Đà Nẵng', 'Дананг'], 'Nha Trang': ['Nha Trang', 'Нячанг'], 'Phu Quoc': ['Phu Quoc', 'Phú Quốc', 'Фукуок'] },
  GE: { Tbilisi: ['Tbilisi', "T'bilisi", 'Тбилиси'], Batumi: ['Batumi', 'Батуми'] },
  EG: { 'Sharm El Sheikh': ['Sharm El Sheikh', 'Sharm El-sheikh', 'Шарм-эль-Шейх'], Hurghada: ['Hurghada', 'Хургада'], Cairo: ['Cairo', 'Каир'] },
  CY: { Limassol: ['Limassol', 'Лимасол'], Paphos: ['Paphos', 'Пафос'] },
  BY: { Minsk: ['Minsk', 'Минск'] }, UZ: { Tashkent: ['Tashkent', 'Ташкент'] },
  ME: { Budva: ['Budva', 'Будва'], Podgorica: ['Podgorica', 'Подгорица'] }
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function decodeBody(bytes: Buffer, responseType?: string): unknown {
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const text = decoded.toString('utf8');
  if (responseType === 'text') return text;
  try { return JSON.parse(text); } catch { return text; }
}
const canonical = (value: any): string => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
async function write(file: string, value: unknown) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
function git(root: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function isoWeek(date: string) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return `${year}-W${String(Math.ceil(((+d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
export function measure(rows: Row[], lastRun: string, clock: string) {
  const today = clock.slice(0, 10);
  const day = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const start = day(14), end = day(90);
  const inWindow = (r: Row) => r.date >= start && r.date <= end;
  const fresh = (r: Row) => Number.isFinite(Date.parse(r.scrapedAt)) && Date.parse(lastRun) - Date.parse(r.scrapedAt) <= 72 * 3600000;
  const counts = (r: Row[]) => ({ allDates: r.length, future: r.filter(x => x.date >= today).length,
    window: r.filter(inWindow).length, windowFresh72h: r.filter(x => inWindow(x) && fresh(x)).length });
  const basket = rows.filter(r => COUNTRIES.includes(r.country));
  const eligible = basket.filter(r => inWindow(r) && fresh(r));
  const groups = new Map<string, Set<string>>();
  for (const r of eligible) {
    const key = JSON.stringify([r.country, r.city, isoWeek(r.date)]);
    if (!groups.has(key)) groups.set(key, new Set()); groups.get(key)!.add(r.artist);
  }
  const weekly = [...groups].map(([key, artists]) => ({ key: JSON.parse(key), artists: [...artists].sort(), triples: Math.floor(artists.size / 3) }));
  const resortTables = Object.entries(CITY_ALIASES).flatMap(([country, cities]) => Object.entries(cities).map(([city, aliases]) => ({ country, city, aliases,
    ...counts(rows.filter(r => r.country === country && aliases.includes(r.city))) })));
  const exactFour = rows.filter(r => (r.country === 'TR' && r.city === 'Antalya') ||
    (r.country === 'AE' && ['Dubai', 'Abu Dhabi'].includes(r.city)) || (r.country === 'TH' && r.city === 'Bangkok'));
  const fourKeys = new Set(exactFour.filter(r => inWindow(r) && fresh(r)).map(r => JSON.stringify([r.country, r.city, isoWeek(r.date)])));
  return { clock, lastRun, start, end, freshness: 'lastRun - scrapedAt <= 72h; extraction age, not event verification',
    countries: COUNTRIES.map(country => ({ country, ...counts(rows.filter(r => r.country === country)) })), basket: counts(basket),
    resorts: resortTables, exactFour: { ...counts(exactFour), groups: fourKeys.size, triples: weekly.filter(w => fourKeys.has(JSON.stringify(w.key))).reduce((a, w) => a + w.triples, 0) },
    editorialCapacity: { groups: weekly.length, triples: weekly.reduce((a, w) => a + w.triples, 0),
      triplesOutsideTR: weekly.filter(w => w.key[0] !== 'TR').reduce((a, w) => a + w.triples, 0),
      byWeek: Object.fromEntries([...new Set(weekly.map(w => w.key[2]))].sort().map(week => [week, weekly.filter(w => w.key[2] === week).reduce((a, w) => a + w.triples, 0)])), weekly },
    futureScrapedAt: basket.filter(r => Date.parse(r.scrapedAt) > Date.parse(lastRun)),
    geographyWarnings: basket.filter(r => r.country === 'TR' && r.city === 'Antalya' && /alanya/i.test(r.venue)),
    unmatchedCityStrings: Object.fromEntries(COUNTRIES.map(c => [c, [...new Set(basket.filter(r => r.country === c && !Object.values(CITY_ALIASES[c]).flat().includes(r.city)).map(r => r.city))].sort()])) };
}
async function treeIdentity(root: string, sources: SourceInput[]) {
  const files = [...git(root, ['ls-files', 'src', 'scrapers', 'data/artists', 'package.json', 'package-lock.json']).split('\n'),
    ...sources.map(s => s.configPath), 'reports/geocode-cache.json', 'reports/geocode-cache-backup.json'].filter(Boolean);
  const entries = [];
  for (const name of [...new Set(files)].sort()) {
    try { entries.push({ path: name, sha256: hash(await fs.readFile(path.join(root, name))) }); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; entries.push({ path: name, absent: true }); }
  }
  return { revision: git(root, ['rev-parse', 'HEAD']), dirty: git(root, ['status', '--short']), files: entries, contentSha256: hash(canonical(entries)) };
}
async function worker(root: string, inputFile: string, out: string) {
  const inputs: Inputs = await readJson(inputFile);
  validateReplayInputs(inputs);
  const before = await treeIdentity(root, inputs.sources);
  await write(path.join(out, 'identity-before.json'), before);
  mock.timers.enable({ apis: ['Date'], now: Date.parse(inputs.clock) });
  const requireAtRoot = createRequire(path.join(root, 'package.json'));
  const axios = requireAtRoot('axios');
  const net = requireAtRoot('node:net'), dns = requireAtRoot('node:dns');
  const networkAttempts: Row[] = [], reads: Row[] = [], missingCaptures: Row[] = [];
  const blocked = (...args: unknown[]) => { networkAttempts.push({ boundary: 'socket-or-dns', argumentType: typeof args[0] }); throw new Error('Offline replay forbids network'); };
  net.Socket.prototype.connect = blocked; dns.lookup = blocked; dns.promises.lookup = blocked;
  syncBuiltinESMExports();
  process.env.SCRAPER_HTTP_BACKEND = 'axios'; // captured response contract, never a live backend
  const available = new Map<string, { entry: ResponseInput; bytes: Buffer }>();
  let sourceIndex = -1;
  const respond = async (url: string) => {
    const found = available.get(new URL(url).href);
    if (!found) { missingCaptures.push({ sourceIndex, url }); throw new Error(`No captured response for ${url}`); }
    const { entry, bytes } = found;
    reads.push({ sourceIndex, url, body: entry.body, sha256: entry.sha256, status: entry.status,
      wireBody: entry.wireBody, wireSha256: entry.wireSha256 });
    return { entry, bytes, text: decodeBody(bytes, 'text') as string };
  };
  axios.get = async (url: string, options: Row = {}) => {
    let requested = new URL(url);
    for (const [key, value] of Object.entries(options.params ?? {})) requested.searchParams.append(key, String(value));
    for (let redirects = 0; ; redirects++) {
      const { entry, bytes } = await respond(requested.href);
      const headers = Object.fromEntries(Object.entries(entry.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      if ([301, 302, 303, 307, 308].includes(entry.status) && headers.location && options.maxRedirects !== 0) {
        assert.ok(redirects < (options.maxRedirects ?? 21), 'Captured redirect limit exceeded');
        requested = new URL(headers.location, requested);
        options.beforeRedirect?.({ hostname: requested.hostname, protocol: requested.protocol, path: requested.pathname });
        continue;
      }
      const response = { status: entry.status, data: decodeBody(bytes, options.responseType), headers };
      const valid = options.validateStatus ? options.validateStatus(entry.status) : entry.status >= 200 && entry.status < 300;
      if (!valid) { const error: any = new Error(`Captured HTTP ${entry.status}`); error.response = response; error.request = {}; throw error; }
      return response;
    }
  };
  globalThis.fetch = async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET', 'Replay only supports captured GET');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { entry, text } = await respond(url);
    assert.ok(![301, 302, 303, 307, 308].includes(entry.status) || init?.redirect === 'manual', 'fetch redirect replay requires explicit captured redirect-chain support');
    return new Response([204, 205, 304].includes(entry.status) ? null : text, { status: entry.status, headers: Object.fromEntries(Object.entries(entry.headers ?? {}).filter(([k]) => !['content-encoding', 'content-length'].includes(k.toLowerCase()))) });
  };
  const fromRoot = (relative: string) => import(pathToFileURL(path.join(root, relative)).href);
  const { runScraper, scraperCacheFingerprint } = await fromRoot('src/engine/runner.ts');
  const { processConcerts, slugify } = await fromRoot('src/pipeline/process.ts');
  const { publishConcerts } = await fromRoot('src/generator/publish.ts');
  const { geocodeConcerts, loadGeocodeCacheWithBackup } = await fromRoot('src/pipeline/geocode.ts');
  const { ScraperConfigSchema } = await fromRoot('src/schemas/config.ts');
  const { buildOfficialArtistContext } = await fromRoot('src/engine/official_artist_sources.ts');
  const raw: Row[] = [], origins: Row[] = [], results: Row[] = [], cache: Row = {};
  for (const source of inputs.sources) {
    sourceIndex++; available.clear();
    for (const entry of source.responses) {
      assert.ok(entry.capturedAt && /^https?:\/\//.test(entry.url));
      const bytes = await fs.readFile(path.resolve(path.dirname(inputFile), entry.body));
      assert.equal(hash(bytes), entry.sha256, `Input changed: ${entry.body}`);
      if (entry.wireBody) {
        assert.equal(hash(await fs.readFile(path.resolve(path.dirname(inputFile), entry.wireBody))), entry.wireSha256, `Wire input changed: ${entry.wireBody}`);
      }
      const urlKey = new URL(entry.url).href;
      assert.ok(!available.has(urlKey), 'One immutable response per URL per source required');
      available.set(urlKey, { entry, bytes });
    }
    const file = path.resolve(root, source.configPath);
    assert.ok(file.startsWith(path.join(root, 'scrapers') + path.sep), 'Only real repo scraper configs permitted');
    let configText: string;
    try { configText = await fs.readFile(file, 'utf8'); } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      results.push({ sourceIndex, configPath: source.configPath, state: 'configAbsent', rawCount: 0 }); continue;
    }
    const config = ScraperConfigSchema.parse(JSON.parse(configText));
    assert.notEqual(config.type, 'playwright_render', 'Browser replay requires an explicit browser route harness; not approximated with HTML');
    const readStart = reads.length;
    const result = await runScraper(config);
    let savedRawEvidence: Row | undefined;
    if (source.savedRaw) {
      const savedBytes = await fs.readFile(path.resolve(path.dirname(inputFile), source.savedRaw));
      const saved = JSON.parse(savedBytes.toString('utf8'));
      const savedRows = Array.isArray(saved) ? saved : saved.concerts;
      assert.ok(Array.isArray(savedRows), 'savedRaw must be raw array or ScraperResult');
      const withoutStamp = (rows: Row[]) => rows.map(({ scrapedAt: _stamp, ...row }) => row);
      savedRawEvidence = { file: source.savedRaw, sha256: hash(savedBytes),
        equalExceptScrapedAt: canonical(withoutStamp(savedRows)) === canonical(withoutStamp(result.concerts)),
        note: 'Observed raw is audit evidence only; publish always consumes fresh extraction of captured HTTP at frozen clock' };
    }
    const resultFile = `sources/${sourceIndex}-${config.id}.json`;
    await write(path.join(out, resultFile), result);
    results.push({ sourceIndex, configPath: source.configPath, configSha256: hash(configText),
      state: result.success ? 'collected' : 'sourceFailed', reason: result.reason, error: result.error,
      rawCount: result.concerts.length, resultFile, savedRawEvidence, responses: reads.slice(readStart) });
    // Failure payloads never become publish inputs. No production caches are fabricated.
    if (!result.success) continue;
    cache[config.id] = { concerts: result.concerts, scrapedAt: result.scrapedAt, verifiedAt: inputs.clock, cacheFingerprint: await scraperCacheFingerprint(config) };
    for (const [rowIndex, row] of result.concerts.entries()) {
      raw.push(row); origins.push({ sourceIndex, configPath: source.configPath, rowIndex, rawSha256: hash(canonical(row)), responses: reads.slice(readStart) });
    }
  }
  const context = await buildOfficialArtistContext(cache, path.join(root, 'scrapers/artists'), Date.parse(inputs.clock));
  const db = path.join(root, 'data/artists');
  // Match run.ts's real cache-only geocode stage. Missing caches are an observed
  // absence, never synthetic coordinates. No cache or artist DB is written.
  const geocodeCache = await loadGeocodeCacheWithBackup(path.join(root, 'reports/geocode-cache.json'), path.join(root, 'reports/geocode-cache-backup.json'));
  const geocodeCacheSha256 = hash(canonical(geocodeCache));
  let diagnostics: unknown, dbCount = 0;
  const processed = await processConcerts(raw, db, inputs.clock, (artists: unknown[]) => { dbCount = artists.length; }, (d: unknown) => { diagnostics = d; }, context);
  const geocodeStats = await geocodeConcerts(processed, { cache: structuredClone(geocodeCache), maxPerRun: 0 });
  assert.equal(geocodeStats.attempted, 0, 'Geocode must remain cache-only');
  assert.ok(dbCount > 0, 'Actual approved DB must be readable and nonempty');
  await write(path.join(out, 'raw.json'), raw);
  await write(path.join(out, 'processing.json'), diagnostics);
  await publishConcerts(processed, path.join(out, 'public'));
  const published: Row[] = await readJson(path.join(out, 'public/concerts.json'));
  const publishedHashes = new Set(published.map(row => hash(canonical(row))));
  const key = (r: Row) => `${slugify(r.artist)}_${r.date}_${slugify(r.city)}`;
  const attribution: Row[] = [];
  // Use the real normalizer for each row: no guessed alias/date joins or field splicing.
  for (const [i, row] of raw.entries()) {
    let singleDiagnostics: any;
    const normalized = await processConcerts([row], db, inputs.clock, undefined, (d: unknown) => { singleDiagnostics = d; }, context);
    await geocodeConcerts(normalized, { cache: structuredClone(geocodeCache), maxPerRun: 0 });
    const normalizedRow = normalized[0];
    attribution.push({ ...origins[i], raw: row, normalized: normalizedRow ?? null,
      state: !normalizedRow ? 'rejected' : publishedHashes.has(hash(canonical(normalizedRow))) ? 'wholeRecordPublished' : 'dedupLoser',
      publishedKey: normalizedRow ? key(normalizedRow) : null, drops: singleDiagnostics.dropped });
  }
  for (const row of published) assert.ok(attribution.some(a => a.state === 'wholeRecordPublished' && canonical(a.normalized) === canonical(row)), 'Every public row must have whole-record raw lineage');
  await write(path.join(out, 'row-provenance.json'), attribution);
  await write(path.join(out, 'measurement.json'), measure(published, inputs.clock, inputs.clock));
  const after = await treeIdentity(root, inputs.sources);
  assert.equal(before.contentSha256, after.contentSha256, 'DB/code/config changed during replay');
  assert.equal(before.revision, after.revision, 'Revision changed during replay');
  assert.equal(before.dirty, after.dirty, 'Working tree changed during replay');
  await write(path.join(out, 'identity-after.json'), after);
  await write(path.join(out, 'summary.json'), { scope: 'affected-cohort-only; no live-full-output or production-gain claim', label: inputs.label,
    clock: inputs.clock, inputSha256: hash(await fs.readFile(inputFile)), revision: before.revision, contentSha256: before.contentSha256,
    dbCount, geocodeCacheSha256, geocodeStats, rawCount: raw.length, publishedCount: published.length, sources: results, networkAttempts, capturedHttpReads: reads, missingCaptures,
    state: networkAttempts.length || missingCaptures.length ? 'incomplete-input-coverage' : results.some(r => r.state === 'sourceFailed') ? 'completed-with-source-failures' : 'replayed',
    exclusions: ['uncaptured providers and existing last-good caches', 'network geocoding/enrichment', 'activity DB writes', 'global publication eligibility/deployment'] });
  assert.equal(networkAttempts.length, 0, 'Unexpected network attempted');
  assert.equal(missingCaptures.length, 0, 'Incomplete captured input set');
  mock.timers.reset();
}
async function compare(base: string, candidate: string, inputs: string, out: string) {
  const sourceInputs: Inputs = await readJson(inputs);
  assert.equal(git(base, ['rev-parse', 'HEAD']), validateReplayInputs(sourceInputs), 'Immutable exact base required');
  if (sourceInputs.candidateRevision) assert.equal(git(candidate, ['rev-parse', 'HEAD']), sourceInputs.candidateRevision, 'Exact GO candidate required');
  assert.equal(git(base, ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'scrapers', 'data/artists']), '', 'Base replay inputs must be clean, including untracked files');
  assert.equal(git(candidate, ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'scrapers', 'data/artists']), '', 'Candidate replay inputs must be clean, including untracked files');
  await fs.mkdir(out, { recursive: true });
  assert.equal((await fs.readdir(out)).length, 0, 'Use a fresh output directory; evidence is never overwritten');
  const inputHash = hash(await fs.readFile(inputs));
  for (const [label, root] of [['base', base], ['candidate', candidate]]) {
    await fs.mkdir(path.join(out, label), { recursive: true });
    const log = await fs.open(path.join(out, label, 'run.log'), 'w');
    const result = spawnSync(process.execPath, ['--import', 'tsx', path.resolve(process.argv[1]), '__worker', root, inputs, path.join(out, label)],
      { cwd: root, env: { ...process.env, TZ: 'UTC' }, stdio: ['ignore', log.fd, log.fd] });
    await log.close(); assert.equal(result.status, 0, `${label} replay failed; see ${label}/run.log`);
  }
  assert.equal(hash(await fs.readFile(inputs)), inputHash, 'Manifest changed during comparison');
  const before: Row[] = await readJson(path.join(out, 'base/public/concerts.json'));
  const after: Row[] = await readJson(path.join(out, 'candidate/public/concerts.json'));
  const { slugify } = await import(pathToFileURL(path.join(base, 'src/pipeline/process.ts')).href);
  const key = (r: Row) => `${slugify(r.artist)}_${r.date}_${slugify(r.city)}`;
  const old = new Map(before.map(r => [key(r), r])), next = new Map(after.map(r => [key(r), r]));
  const delta = { added: after.filter(r => !old.has(key(r))), removed: before.filter(r => !next.has(key(r))),
    changed: after.filter(r => old.has(key(r)) && canonical(old.get(key(r))) !== canonical(r)).map(r => ({ key: key(r), before: old.get(key(r)), after: r })) };
  await write(path.join(out, 'delta.json'), delta);
  const baseSummary = await readJson(path.join(out, 'base/summary.json'));
  const candidateSummary = await readJson(path.join(out, 'candidate/summary.json'));
  assert.equal(baseSummary.geocodeCacheSha256, candidateSummary.geocodeCacheSha256, 'Same geocode-cache input required');
  if (sourceInputs.candidateRevision) assert.equal(candidateSummary.revision, sourceInputs.candidateRevision, 'Candidate changed after GO');
  const candidateProvenance: Row[] = await readJson(path.join(out, 'candidate/row-provenance.json'));
  await write(path.join(out, 'new-events-review.json'), delta.added.map(row => ({ row, correctness: 'owner/source spot-check required; mechanical gain only',
    provenance: candidateProvenance.filter(a => a.state === 'wholeRecordPublished' && canonical(a.normalized) === canonical(row)) })));
  const counts = (rows: Row[]) => COUNTRIES.map(country => ({ country, count: rows.filter(r => r.country === country).length }));
  await write(path.join(out, 'comparison.json'), { scope: 'same-input affected-cohort; never subtract from live full snapshot', clock: sourceInputs.clock,
    inputSha256: inputHash, base: await readJson(path.join(out, 'base/summary.json')), candidate: await readJson(path.join(out, 'candidate/summary.json')),
    added: delta.added.length, removed: delta.removed.length, changed: delta.changed.length,
    addedByCountry: counts(delta.added), removedByCountry: counts(delta.removed), baseMeasurement: measure(before, sourceInputs.clock, sourceInputs.clock),
    candidateMeasurement: measure(after, sourceInputs.clock, sourceInputs.clock) });
}
async function main() {
  process.env.TZ = 'UTC';
  const args = process.argv.slice(2);
  if (args[0] === '__worker') { await worker(...args.slice(1) as [string, string, string]); return; }
  const option = (name: string) => { const i = args.indexOf(name); assert.ok(i >= 0 && args[i + 1], `Missing ${name}`); return path.resolve(args[i + 1]); };
  const out = option('--out');
  if (args.includes('--live')) {
    const dir = option('--live');
    const capture: Row[] = await readJson(path.join(dir, 'capture.json'));
    for (const entry of capture.filter(r => r.sha256)) assert.equal(hash(await fs.readFile(path.join(dir, entry.file))), entry.sha256, entry.file);
    const index = await readJson(path.join(dir, 'index.json'));
    const rows = await readJson(path.join(dir, 'concerts.json'));
    assert.equal(index.stats.totalConcerts, rows.length);
    await write(path.join(out, 'live-measurement.json'), { scope: 'observed published snapshot; entries not independently verified unique concerts', capture,
      ...measure(rows, index.lastRun, '2026-10-16T00:00:00.000Z') });
    return;
  }
  await compare(option('--base'), option('--candidate'), option('--inputs'), out);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
