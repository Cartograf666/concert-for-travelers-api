import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runScraper, closeBrowser } from '../src/engine/runner.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

test('rendered extraction waits for asynchronously loaded events or an explicit empty state', async (t) => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    const content = req.url === '/empty' ? '<p class="empty">No Upcoming Shows</p>'
      : '<article><h2>Pharis &amp; Jason Romero</h2><time>2027-04-17</time></article>';
    res.end(`<main>Loading...</main><script>setTimeout(()=>document.querySelector('main').innerHTML=${JSON.stringify(content)}, 700)</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await closeBrowser(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = ScraperConfigSchema.parse({
    id:'rendered-readiness-test', domain:'readiness.test', url:'https://readiness.example/events',
    type:'playwright_render', renderWaitSelector:'article, .empty', allowEmpty:true, emptyScheduleText:'No Upcoming Shows',
    selectors:{eventBlock:'article', artist:'h2', date:'time', venueNameFallback:'Anvil Centre', cityNameFallback:'New Westminster', countryNameFallback:'CA'}
  });
  base.url = `http://127.0.0.1:${address.port}/events`;
  const events = await runScraper(base);
  assert.equal(events.success, true, events.error);
  assert.equal(events.concerts.length, 1);
  assert.equal(events.concerts[0].date, '2027-04-17');
  const empty = await runScraper({...base, url:new URL('/empty',base.url).href});
  assert.equal(empty.success, true, empty.error);
  assert.equal(empty.reason, 'empty_schedule');
});

test('rendered custom parser captures only the exact JSON API requested by the page', async (t) => {
  const feed = await readFile('tests/fixtures/artist-sources-recovery-20261006/artist-emancipator.json', 'utf8');
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url || '');
    if (req.url?.startsWith('/api/')) {
      const denied = req.url === '/api/denied';
      res.writeHead(denied ? 403 : 200, { 'content-type': 'application/json' });
      res.end(denied ? '{"error":"denied"}' : feed);
    } else {
      const api = req.url === '/denied' ? '/api/denied' : '/api/events';
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<h1>Schedule without years</h1><script>fetch(${JSON.stringify(api)}).then(r=>r.json())</script>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await closeBrowser(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = ScraperConfigSchema.parse({
    id:'artist-emancipator', domain:'emancipatormusic.com', url:'https://emancipatormusic.com/',
    type:'playwright_render', renderParser:'custom_js', renderResponseUrl:'https://emancipatormusic.com/api/events',
    selectors:{eventBlock:'unused',date:'unused',artistNameFallback:'Emancipator',venueNameFallback:'',cityNameFallback:'',countryNameFallback:'US'}
  });
  base.url = `http://127.0.0.1:${address.port}/events`;
  base.renderResponseUrl = new URL('/api/events',base.url).href;
  const events = await runScraper(base);
  assert.equal(events.success, true, events.error);
  assert.equal(events.concerts.length, 12);
  assert.equal(events.concerts.find(e=>e.city==='Vancouver')?.country,'CA');
  assert.equal(requests.filter(url=>url==='/api/events').length,1,'capture must not issue an extra request');
  const denied = await runScraper({...base,url:new URL('/denied',base.url).href,renderResponseUrl:new URL('/api/denied',base.url).href});
  assert.equal(denied.success,false);
  assert.match(denied.error || '',/HTTP 403/);
});

test('rendered empty notice hidden by a stylesheet cannot clear prior concerts', async (t) => {
  const server = createServer((_, res) => {
    res.setHeader('content-type','text/html');
    res.end('<style>.hidden-notice {display:none}</style><main><p class="hidden-notice">No Upcoming Shows</p><p>Schedule loading</p></main>');
  });
  await new Promise<void>((resolve)=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await closeBrowser();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  const address=server.address();assert.ok(address && typeof address==='object');
  const result = await runScraper({
    id:'rendered-hidden-notice',domain:'hidden-notice.test',url:`http://127.0.0.1:${address.port}/`,
    type:'playwright_render',allowEmpty:true,emptyScheduleText:'No Upcoming Shows',
    selectors:{eventBlock:'article',artist:'h2',date:'time',venueNameFallback:'Hall',cityNameFallback:'London',countryNameFallback:'GB'}
  });
  assert.equal(result.success,false);
  assert.notEqual(result.reason,'empty_schedule');
});
