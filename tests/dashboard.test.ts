import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function render(payloads: Record<string, unknown>) {
  const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1].split('</script>')[0].replace(/load\(\);\s*setInterval\(load, 60000\);/, '');
  const elements = new Map<string, { innerHTML: string; textContent: string; className: string; appendChild: (child: unknown) => void }>();
  const element = () => ({ innerHTML: '', textContent: '', className: '', appendChild: () => {}, setAttribute: () => {} });
  const context = vm.createContext({
    document: {
      getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element
    },
    fetch: async (url: string) => ({ ok: url.split('?')[0] in payloads, status: 404, json: async () => payloads[url.split('?')[0]] }),
    console
  });
  vm.runInContext(script, context);
  await vm.runInContext('load()', context);
  return elements;
}

function status() {
  const generatedAt = new Date().toISOString();
  const report = { schemaVersion: 1, generatedAt, state: 'healthy', counts: {}, freshness: {}, completeness: 'complete', issues: [] };
  return {
    schemaVersion: 3, generatedAt, scrapersTotal: 1, scrapersOk: 1,
    sources: { venue: { total: 1, succeeded: 1, failed: 0 }, artist: { total: 1, succeeded: 1, failed: 0, generatedAt } },
    sourceHealth: Object.fromEntries(['venue', 'artist', 'bandsintown', 'eventbrite', 'ticketmaster'].map(key => [key, { ...report, source: key }]))
  };
}

test('missing status never renders a healthy system even when concert feed loads', async () => {
  const el = await render({ './concerts.json': [], './index.json': {} });
  assert.equal(el.get('health')?.textContent, 'STATUS UNAVAILABLE');
  assert.match(el.get('source-health')!.innerHTML, /No verification report available/);
  assert.doesNotMatch(el.get('health-detail')!.innerHTML, /All parsers healthy/);
});

test('failed provider degrades the badge despite healthy scraper cohorts and preserves empty live counts', async () => {
  const s = status();
  s.sourceHealth.eventbrite.state = 'unavailable';
  const el = await render({ './status.json': s, './concerts.json': [], './index.json': { stats: { totalConcerts: 99 } } });
  assert.equal(el.get('health')?.textContent, 'DEGRADED');
  assert.match(el.get('source-health')!.innerHTML, /UNAVAILABLE/);
  assert.match(el.get('cards')!.innerHTML, /class="n">0<\/div><div class="l">Concerts live/);
  assert.doesNotMatch(el.get('cards')!.innerHTML, />99</);
});

test('legacy status shows unknown provider reports, and diagnostic text is escaped', async () => {
  const s = { ...status(), sourceHealth: undefined, processing: { schemaVersion: 1, generatedAt: new Date().toISOString(), dropped: {}, sources: { '<img src=x onerror=bad()>': { rawCount: 1, publishedCount: 0, dropped: {} } } } };
  const el = await render({ './status.json': s, './concerts.json': [] });
  assert.notEqual(el.get('health')?.textContent, 'HEALTHY');
  assert.match(el.get('processing')!.innerHTML, /&lt;img/);
  assert.doesNotMatch(el.get('processing')!.innerHTML, /<img/);
});

test('expired provider report is visible even with successful past outcomes', async () => {
  const s = status();
  s.sourceHealth.bandsintown.generatedAt = '2020-01-01T00:00:00Z';
  const el = await render({ './status.json': s, './concerts.json': [] });
  assert.notEqual(el.get('health')?.textContent, 'HEALTHY');
  assert.match(el.get('source-health')!.innerHTML, /OLD REPORT/);
});

test('city metric uses publisher canonical grouping rather than raw city labels', async () => {
  const concerts = [
    { artist: 'A', city: 'Tokyo', country: 'JP' },
    { artist: 'B', city: '東京都', country: 'JP' },
    { artist: 'C', city: 'London', country: 'GB' }
  ];
  const el = await render({ './status.json': status(), './concerts.json': concerts, './index.json': { stats: { uniqueCities: 2 } } });
  assert.match(el.get('cards')!.innerHTML, /class="n">2<\/div><div class="l">Cities/);
  assert.doesNotMatch(el.get('cards')!.innerHTML, /class="n">3<\/div><div class="l">Cities/);
});

test('missing publisher city count labels the ungrouped fallback explicitly', async () => {
  const el = await render({ './status.json': status(), './concerts.json': [{ artist: 'A', city: 'Tokyo', country: 'JP' }] });
  assert.match(el.get('cards')!.innerHTML, /class="n">1<\/div><div class="l">City labels \(ungrouped\)/);
});

test('access challenge shows its specific recovery action and unknown age meaning', async () => {
  const s = status();
  Object.assign(s.sourceHealth.eventbrite, {
    state: 'unavailable', counts: { targets: 20765, attempted: 5, failed: 5 },
    freshness: { fresh: 0, old: 0, unknown: 20765 },
    issues: [{ reason: 'access_challenge', count: 5, action: 'obtain_authorized_source_access' }]
  });
  const el = await render({ './status.json': s, './concerts.json': [] });
  assert.match(el.get('source-health')!.innerHTML, /authorized access/);
  assert.match(el.get('source-health')!.innerHTML, /Unknown means no successful verification timestamp/);
});
