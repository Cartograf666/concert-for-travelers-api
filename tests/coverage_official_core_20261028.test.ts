import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import axios from 'axios';
import { loadConfigs, runScraper } from '../src/engine/runner.js';
import { processConcerts } from '../src/pipeline/process.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';
import { scrape as godspeed } from '../src/engine/custom/artist-godspeed-you-black-emperor.js';
import { scrape as hardOns } from '../src/engine/custom/artist-hard-ons.js';
import { scrape as paula } from '../src/engine/custom/artist-paula-fernandes.js';

const fixture = (name: string) => readFileSync(`tests/fixtures/coverage-official-core-20261028/${name}.html`, 'utf8');
const config = (id: string) => ScraperConfigSchema.parse(JSON.parse(readFileSync(`scrapers/artists/artist-${id}.json`, 'utf8')));
const at = '2026-10-28T00:00:00.000Z';
const configs = [config('hard-ons'), config('godspeed-you-black-emperor'), config('paula-fernandes')];
const dates = [
  ['04','05','06','07','10','11','12','13','14','18','19','20','21'].map(day => `2027-03-${day}`),
  ['2026-11-21','2026-11-23','2026-11-24','2026-11-26','2027-02-20','2027-02-21','2027-02-22','2027-02-23','2027-02-24','2027-02-26','2027-02-27','2027-03-03','2027-03-04'],
  ['2026-12-05','2027-03-19','2027-03-20','2027-04-02','2027-04-03','2027-04-04','2027-05-15','2027-06-05']
];

test('normal loader and actual runner parsers recover exact source dates, then process and deduplicate', async t => {
  const loaded = await loadConfigs('scrapers/artists');
  for (const c of configs) assert.ok(loaded.some(row => row.id === c.id && row.url === c.url));
  const pages: Record<string, string> = {
    [configs[0].url]: fixture('hard-ons-index'), [configs[1].url]: fixture('godspeed'), [configs[2].url]: fixture('paula-venue'),
    'https://bespoketouring.oztix.com.au/Default.aspx?Event=251910': fixture('hard-ons-251910'),
    'https://bespoketouring.oztix.com.au/Default.aspx?Event=251911': fixture('hard-ons-251911')
  };
  t.mock.method(axios, 'get', async (url: string) => {
    assert.ok(pages[url], `unexpected request ${url}`);
    return { status: 200, data: pages[url], headers: {} };
  });
  const all = [];
  for (const [i, c] of configs.entries()) {
    const result = await runScraper({ ...c, requestDelayMs: 0 });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.concerts.map(row => row.date).sort(), dates[i]);
    all.push(...result.concerts);
  }
  assert.equal(all.length, 34);
  assert.deepEqual(all.filter(row => row.artist === 'Hard-Ons').map(row => [row.city, row.venue, row.country]), [
    ['Woy Woy','Link & Pin','AU'],['Adelaide','Ed Castle','AU'],['Inglewood','Milk Bar','AU'],
    ['Margaret River','The River','AU'],['Canberra','Dissent','AU'],['Geelong','Barwon Club','AU'],
    ['Melbourne','The Tote','AU'],['Frankston','Singing Bird','AU'],['Hobart','Altar','AU'],
    ['Newcastle','The Hamo','AU'],['Sydney','Paddo RSL','AU'],['Gold Coast','Vinnies Dive','AU'],['Brisbane','The Brightside','AU']
  ]);
  assert.deepEqual(all.filter(row => row.artist === 'Godspeed You! Black Emperor').map(row => [row.city, row.venue, row.country]), [
    ['Buenos Aires','C Art Media','AR'],['São Paulo','Audio','BR'],['São Paulo','Audio','BR'],
    ['Santiago de Chile','Fauna Primavera Festival','CL'],['Québec City','Théâtre Capitole','CA'],['Québec City','Théâtre Capitole','CA'],
    ['Montréal','Club Soda','CA'],['Montréal','Club Soda','CA'],['Montréal','Club Soda','CA'],
    ['Toronto','Danforth Music Hall','CA'],['Toronto','Danforth Music Hall','CA'],['San Juan','La Respuesta','PR'],['San Juan','La Respuesta','PR']
  ]);
  assert.deepEqual(all.filter(row => row.artist === 'Paula Fernandes').map(row => [row.city, row.venue, row.country]), [
    ['São Paulo','Vibra','BR'],['Porto Alegre','Teatro do Bourbon Country','BR'],['Curitiba','Teatro Positivo','BR'],
    ['Recife','Teatro RioMar Recife','BR'],['Natal','Teatro Riachuelo Natal','BR'],['Fortaleza','Teatro RioMar Fortaleza','BR'],
    ['Belo Horizonte','Minascentro','BR'],['Rio de Janeiro','Qualistage','BR']
  ]);

  assert.ok(!all.some(row => row.date === '2027-07-22'), 'festival window excluded');
  assert.ok(!all.some(row => row.artist === 'Paula Fernandes' && row.date === '2027-03-10'));
  const hard = all.filter(row => row.artist === 'Hard-Ons');
  assert.equal(hard.filter(row => row.ticketUrl).length, 2, 'only two dedicated Oztix event links');
  assert.equal(hard.find(row => row.date === '2027-03-06')?.city, 'Inglewood');
  assert.equal(all.filter(row => row.artist === 'Paula Fernandes' && row.ticketUrl).length, 1);
  const dir = await mkdtemp(join(tmpdir(), 'official-core-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const approved = join(dir, 'artists.json');
  await writeFile(approved, JSON.stringify(configs.map(c => ({name: c.selectors?.artistNameFallback}))));
  const processed = await processConcerts([...all, ...all], approved, at);
  assert.equal(processed.length, 34, 'no registry trust or cache injection needed');
  for (const [i,c] of configs.entries()) assert.deepEqual(processed.filter(row => row.artist === c.selectors?.artistNameFallback).map(row => row.date).sort(), dates[i]);
});

test('Godspeed isolates artist Live Dates, guards malformed/empty/cancelled rows and province identities', async () => {
  const c=configs[1], html=fixture('godspeed');
  await assert.rejects(godspeed(c, '<html></html>', at), /identity/);
  await assert.rejects(godspeed(c, '<h1>Godspeed You! Black Emperor</h1><strong>Live Dates</strong><div class="cst-content-block"><div class="metafield-rich_text_field"></div></div>', at), /empty/);
  await assert.rejects(godspeed(c, html.replaceAll('<h1>Godspeed You! Black Emperor</h1>', '<h1>Other Artist</h1>'), at), /identity/);
  await assert.rejects(godspeed(c, html.replaceAll('Live Dates', 'Archive'), at), /section/);
  await assert.rejects(godspeed(c, html.replaceAll('21 Nov 2026', '31 Nov 2026'), at), /date or country/);
  await assert.rejects(godspeed(c, html.replaceAll('Montréal, QC', 'Montréal, XX'), at), /date or country/);
  await assert.rejects(godspeed(c, html.replaceAll('21 Nov 2026', 'not a date'), at), /malformed/);
  const cancelled = await godspeed(c, html.replaceAll('21 Nov 2026 - Buenos Aires', '21 Nov 2026 - Cancelled Buenos Aires'), at);
  assert.ok(!cancelled.some(row => row.date === '2026-11-21'));
  await assert.rejects(godspeed(c, html.replaceAll('https://www.passline.com/eventos/godspeed-you-black-emperor-c-art-media', 'javascript:alert(1)'), at), /safe event link/);
  const injected = html.replace('</body>', '<p>01 Jan 2027 - Another City, Brazil - <a><strong>Wrong</strong></a></p></body>');
  assert.equal((await godspeed(c, injected, at)).length, 13);
});

test('Hard-Ons uses guarded catalog discovery, band identity, current pages and cancellation fail-closed', async () => {
  const c={...configs[0],requestDelayMs:0}, index=fixture('hard-ons-index'), body=fixture('hard-ons-251910');
  const fetchPage = async () => body;
  await assert.rejects(hardOns(c, '<html/>', at, fetchPage), /identity/);
  await assert.rejects(hardOns(c, index.replaceAll('Hard-Ons with Jerry A', 'Poison Idea'), at, fetchPage), /empty/);
  await assert.rejects(hardOns(c, index.replaceAll('/Default.aspx?Event=251910', 'https://127.0.0.1/Default.aspx?Event=251910'), at, fetchPage), /invalid/);
  await assert.rejects(hardOns(c, index, at, async () => {throw new Error('fetch failed');}), /fetch failed/);
  await assert.rejects(hardOns(c, index, at, async () => body.replaceAll('EventScheduled', 'EventCancelled')), /cancelled/);
  await assert.rejects(hardOns(c, index, at, async () => body.replaceAll('AUSTRALIAN TOUR MARCH 2027', 'TOUR TBD')), /year/);
  await assert.rejects(hardOns(c, index, at, async () => body.replaceAll('March 4 - Link', 'March 32 - Link')), /impossible/);
  await assert.rejects(hardOns(c, index, at, async () => body.replaceAll('"addressCountry":"Australia"', '"addressCountry":"Unknown"')), /country/);
  await assert.rejects(hardOns(c,index,at,async()=>body.replaceAll('March 4 - Link', 'March 4 - Cancelled Link')), /require revalidation/);
});

test('Hard-Ons rejects conflicting itinerary status in either organizer page order', async t => {
  const c={...configs[0],requestDelayMs:0}, originalIndex=fixture('hard-ons-index');
  const firstUrl='https://bespoketouring.oztix.com.au/Default.aspx?Event=251910';
  const secondUrl='https://bespoketouring.oztix.com.au/Default.aspx?Event=251911';
  // Reverse discovered link order, keeping both genuine source page bodies.
  const reversedIndex=originalIndex.replaceAll('251910','ORDER_SWAP').replaceAll('251911','251910').replaceAll('ORDER_SWAP','251911');
  for (const [order,index] of [['first',originalIndex],['last',reversedIndex]]) {
    for (const status of ['CANCELLED','CANCELED','POSTPONED']) {
      await t.test(`${status} copy encountered ${order}`, async t => {
        const pages: Record<string,string> = {
          [firstUrl]:fixture('hard-ons-251910').replaceAll('March 4 - Link',`March 4 - ${status} Link`),
          [secondUrl]:fixture('hard-ons-251911')
        };
        const requested:string[]=[];
        t.mock.method(axios,'get',async (url:string)=> {
          if(url===c.url) return {status:200,data:index,headers:{}};
          assert.ok(pages[url],`unexpected request ${url}`);
          requested.push(url);
          return {status:200,data:pages[url],headers:{}};
        });
        const result=await runScraper(c);
        assert.equal(result.success,false,'a stale active copy cannot confirm a contradictory date');
        assert.deepEqual(result.concerts,[],'no accumulated active rows escape the failed scrape');
        assert.match(result.error??'',/conflicting copies require revalidation/);
        assert.deepEqual(requested,order==='first'?[firstUrl]:[secondUrl,firstUrl]);
      });
    }
    const baseline=await hardOns(c,index,at,async url=>url===firstUrl?fixture('hard-ons-251910'):fixture('hard-ons-251911'));
    assert.equal(baseline.length,13);
    assert.deepEqual(baseline.map(row=>row.date).sort(),dates[0]);
  }
});

test('Paula preserves exact Curitiba date and rejects missing identity, empty, impossible, unknown state and cancellation', async () => {
  const c=configs[2], html=fixture('paula-venue');
  await assert.rejects(paula(c,'',at), /identity/);
  const empty = html.replace(/<p style="text-align: justify;">05 de dezembro[\s\S]*?Qualistage<\/p>/, '<p></p>');
  await assert.rejects(paula(c,empty,at), /empty/);
  await assert.rejects(paula(c,html.replace('Dia 04/04','Dia 05/04'),at), /disagrees/);
  await assert.rejects(paula(c,html.replaceAll('Paula Fernandes - 30 e Poucos Anos','Other Artist'),at), /identity/);
  await assert.rejects(paula(c,html.replaceAll('As primeiras datas confirmadas','Archive dates'),at), /heading/);
  await assert.rejects(paula(c,html.replace('20 de mar&ccedil;o de 2027','32 de mar&ccedil;o de 2027'),at), /unsupported/);
  await assert.rejects(paula(c,html.replace('Curitiba/PR','Curitiba/ZZ'),at), /unsupported/);
  await assert.rejects(paula(c,html.replace('Curitiba/PR','Curitiba/PR cancelado'),at), /cancellation/);
  await assert.rejects(paula(c,html.replace('20 de mar&ccedil;o de 2027','TBD'),at), /malformed/);
});
