import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { runScraper } from '../src/engine/runner.js';
import { buildApprovedMatcher } from '../src/pipeline/process.js';

const configPromise = readFile('scrapers/helitehas-tallinn.json', 'utf8')
  .then((source) => ScraperConfigSchema.parse(JSON.parse(source)));

async function runWithBody(body: string) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = await configPromise;
    return await runScraper({ ...config, url: `http://127.0.0.1:${address.port}/kava.php` });
  } finally {
    server.close();
  }
}

test('Helitehas JSON schedule keeps available events, local time, and safe links', async () => {
  const result = await runWithBody(JSON.stringify({ ok: true, events: [
    { title: '  Singer   Vinger  ', ara: false, iso: '2026-10-09T19:00:00+03:00', url: '/tickets/1' },
    { title: 'Cancelled', ara: true, iso: '2026-10-10T20:00:00+03:00', url: '/tickets/2' },
    { title: 'Second act', ara: false, iso: '2026-11-06T22:30:00+02:00', url: 'https://tickets.example/show?x=1&#038;y=2' },
    { title: 'Unsafe link', ara: false, iso: '2026-12-01T21:00:00+02:00', url: 'javascript:alert(1)' }
  ] }));
  assert.equal(result.success, true);
  assert.match(result.concerts[0].ticketUrl || '', /^http:\/\/127\.0\.0\.1:\d+\/tickets\/1$/);
  assert.deepEqual(result.concerts.map(({ artist, date, startTime, ticketUrl }) =>
    ({ artist, date, startTime, ticketUrl })), [
    { artist: 'Singer Vinger', date: '2026-10-09', startTime: '19:00', ticketUrl: result.concerts[0].ticketUrl },
    { artist: 'Second act', date: '2026-11-06', startTime: '22:30', ticketUrl: 'https://tickets.example/show?x=1&y=2' },
    { artist: 'Unsafe link', date: '2026-12-01', startTime: '21:00', ticketUrl: undefined }
  ]);
  assert.ok(result.concerts.every((event) => event.venue === 'Helitehas' && event.city === 'Tallinn' && event.country === 'EE'));
});

test('invalid and short JSON responses fail so the run can retain cached events', async () => {
  for (const body of ['<html>challenge</html>', '{"ok":false,"events":[]}',
    '{"ok":true,"events":[{"title":"Only one"}]}']) {
    const result = await runWithBody(body);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'parse_error');
  }
});

test('confirmed Helitehas title formats expose the lead act and explicit lineup only', async () => {
  const result = await runWithBody(JSON.stringify({ ok: true, events: [
    { title: 'Camouflage Live Tallinn 17. oktoober 2026', ara: false, iso: '2026-10-17T19:30:00+03:00' },
    { title: 'Whitechapel (US), Sylosis (UK), 200 Stab Wounds (US), Tribal gaze (US)', ara: false, iso: '2027-02-28T19:00:00+02:00' },
    { title: 'Little Big Live Concert — Tallinn, Estonia', ara: false, iso: '2026-10-16T20:00:00+03:00' },
    { title: 'Cancelled (US), Another Act (UK)', ara: true, iso: '2026-10-18T20:00:00+03:00' }
  ] }));
  assert.equal(result.success, true);
  assert.deepEqual(result.concerts.map(({ artist, lineup }) => ({ artist, lineup })), [
    { artist: 'Camouflage', lineup: undefined },
    { artist: 'Whitechapel', lineup: ['Sylosis', '200 Stab Wounds', 'Tribal gaze'] },
    { artist: 'Little Big Live Concert — Tallinn, Estonia', lineup: undefined }
  ]);
  const match = buildApprovedMatcher(['Camouflage', 'Whitechapel', 'Sylosis', 'Show Luo']);
  assert.equal(match(result.concerts[0].artist!)?.name, 'Camouflage');
  assert.equal(match(result.concerts[1].artist!)?.name, 'Whitechapel');
  assert.equal(match(result.concerts[2].artist!), null);
});
