import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';
import { scrape } from '../src/engine/custom/kitty-su-bangalore.js';
import { runScraper } from '../src/engine/runner.js';
import { buildApprovedMatcher, processConcerts } from '../src/pipeline/process.js';
import { loadApprovedArtists } from '../src/pipeline/artistDb.js';
import { isVerifiedSourceIdentityCollision } from '../src/pipeline/provider_identity_exclusions.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
const NOW = '2026-10-10T10:54:07.538Z';
async function context() {
  const config = ScraperConfigSchema.parse(JSON.parse(await readFile('scrapers/kitty-su-bangalore.json','utf8')));
  const fixture = JSON.parse(await readFile('tests/fixtures/kitty-su-native-20261011.json','utf8'));
  return {config,fixture};
}

test('stock native detail recovers DJ Kish/full date/time/Kitty Ko, while actual catalogue collision cannot publish DJ Krush', async t => {
  const {config,fixture} = await context();
  const requests: string[] = [];
  t.mock.method(axios,'get',async (url: string) => {
    requests.push(url);
    assert.ok(url===config.url || url===fixture.detailSource);
    return {status:200,data:url===config.url?fixture.indexHtml:fixture.detailHtml,headers:{}};
  });
  const result = await runScraper(config);
  assert.equal(result.success,true);
  assert.deepEqual(requests,[config.url,fixture.detailSource]);
  assert.equal(result.concerts.length,1);
  const raw = result.concerts[0];
  assert.deepEqual([raw.artist,raw.date,raw.startTime,raw.venue,raw.city,raw.country],
    ['DJ Kish','2026-10-18','20:30','Kitty Ko The LaLiT Ashok Bangalore','Bangalore','IN']);
  assert.equal(raw.lat,undefined);
  assert.equal(raw.lng,undefined);
  assert.equal(raw.sourceEventUrl,fixture.detailSource);
  const matched = buildApprovedMatcher(await loadApprovedArtists('data/artists'))(raw.artist!);
  assert.equal(matched?.name,'DJ Krush','Reproduce the unchanged fuzzy matcher risk separately');
  assert.equal(matched?.mbid,'38d16213-25ba-450d-8665-4e08548e62e3');
  const before = structuredClone(raw);
  let dropped = 0;
  assert.deepEqual(await processConcerts([raw],'data/artists',NOW,undefined,r=>{dropped=r.dropped.notApproved;}),[]);
  assert.equal(dropped,1);
  assert.deepEqual(raw,before);
});

test('source-bound stable-ID quarantine retains genuine DJ Krush, unambiguous alias and unrelated source fuzzy controls', async () => {
  const {config,fixture} = await context();
  const [raw] = await scrape(config,fixture.indexHtml,NOW,async url=>{
    assert.equal(url,fixture.detailSource);return fixture.detailHtml;
  });
  assert.equal(isVerifiedSourceIdentityCollision(raw,'38d16213-25ba-450d-8665-4e08548e62e3'),true);
  assert.equal(isVerifiedSourceIdentityCollision(raw,'11111111-1111-4111-8111-111111111111'),false);
  const controls = [
    {...raw,artist:'DJ Krush'},
    {...raw,artist:'DJクラッシュ',date:'2026-10-19'},
    {...raw,originalSource:'venue.example',date:'2026-10-20'},
    {...raw,sourceEventUrl:'https://www.kittysu.com/event/different-event',date:'2026-10-21'},
    {...raw,venue:'Different Venue',date:'2026-10-22'}
  ];
  const published = await processConcerts(controls,'data/artists',NOW);
  assert.equal(published.length,5);
  assert.ok(published.every(row=>row.artist==='DJ Krush' && row.mbid==='38d16213-25ba-450d-8665-4e08548e62e3'));
  assert.deepEqual(await processConcerts([raw,...controls],'data/artists',NOW),published);
});

test('missing native year/performer/venue and listing date conflict fail source rather than guess; unsafe URLs are never fetched', async () => {
  const {config,fixture} = await context();
  for (const mutate of [
    (html: string)=>html.replace('18th October 2026','18th October'),
    (html: string)=>html.replace('DJ Kish','Mystery Performer'),
    (html: string)=>html.replaceAll('Kitty Ko The LaLiT Ashok Bangalore','Unknown Venue'),
    (html: string)=>html.replace('18th October 2026','19th October 2026'),
    (html: string)=>html.replace('18th October 2026','32nd October 2026')
  ]) {
    const altered = mutate(fixture.detailHtml);
    assert.notEqual(altered,fixture.detailHtml);
    await assert.rejects(scrape(config,fixture.indexHtml,NOW,async ()=>altered),/Kitty Su/);
  }
  await assert.rejects(scrape(config,fixture.indexHtml,NOW,async()=>{throw new Error('Detail unavailable');}),/Detail unavailable/);
  await assert.rejects(scrape(config,fixture.indexHtml.replaceAll('/event/PureLoveSundayPresentsKoothRoyaltyTributeToLadyBai',
    'https://evil.example/event/fake'),NOW,async()=>{throw new Error('Unexpected fetch');}),/unsafe native/);
});


test('missing or foreign producer identity is rejected even for an all-Kolkata page', async () => {
  const {config} = await context();
  const html = await readFile('tests/fixtures/venue-sources-recovery-20261006/kitty-su-bangalore.html','utf8');
  assert.match(html, /<title>Kitty Su<\/title>/);
  for (const input of [html.replace('<title>Kitty Su</title>',''),html.replace('<title>Kitty Su</title>','<title>Blocked</title>')]) {
    await assert.rejects(scrape(config,input,NOW,async()=>{assert.fail('Invalid producer must not fetch details');}),
      /native programme identity missing/);
  }
});
