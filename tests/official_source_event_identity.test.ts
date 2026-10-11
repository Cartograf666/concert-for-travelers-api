import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { processConcerts } from '../src/pipeline/process.js';
import { verifiedOfficialSourceEventIdentity } from '../src/pipeline/official_source_event_identity.js';
import type { Concert, RawConcert } from '../src/schemas/concert.js';
const NOW = '2026-10-10T10:54:07.538Z';
const DB = 'data/artists';
type Pair = { native: RawConcert; provider: Concert };
async function fixture(): Promise<{pairs: Pair[]; baseline: Concert[]}> {
  return JSON.parse(await readFile('tests/fixtures/blue-october-event-pairs-20261010.json', 'utf8'));
}
function records(rows: Concert[]) {
  return JSON.parse(JSON.stringify([...rows].sort((a,b) =>
    `${a.artist}|${a.date}|${a.city}`.localeCompare(`${b.artist}|${b.date}|${b.city}`))));
}

test('seventy source-only Blue records keep native locations; mixed pairs preserve all 106 full baseline records both orders', async () => {
  const {pairs,baseline} = await fixture();
  const native = pairs.map(p => p.native), before = structuredClone(native);
  const sourceOnly = await processConcerts(native, DB, NOW);
  assert.equal(sourceOnly.length, 70);
  assert.equal(sourceOnly.find(row => row.date === '2027-02-11')?.city, 'Funner');
  assert.equal(sourceOnly.find(row => row.date === '2027-02-11')?.venue, 'Harrah’s Resort Southern California');
  assert.ok(sourceOnly.every(row => row.originalSource === 'www.blueoctober.com'));
  const expected = records(await processConcerts(baseline, DB, NOW));
  assert.equal(expected.length, 106);
  assert.deepEqual(expected, records(baseline), 'Actual catalogue metadata must match preserved-public baseline');
  for (const input of [[...baseline,...native], [...native,...baseline]]) {
    let duplicates = 0;
    const mixed = await processConcerts(input, DB, NOW, undefined, r => {duplicates = r.duplicatesMerged;});
    assert.equal(mixed.length, 106);
    assert.equal(duplicates, 70);
    assert.deepEqual(records(mixed), expected, 'No field or identity in an existing counterpart may change with source order');
  }
  assert.deepEqual(native,before, 'Pair keys must not rewrite source-only geography or provenance');
});

test('Funner/Valley Center known event keeps one complete counterpart including all optional metadata', async () => {
  const {pairs} = await fixture();
  const pair = pairs.find(p => p.native.date === '2027-02-11')!;
  const provider = { ...pair.provider, festival: {name:'Fixture Festival'}, lineup:['Fixture Support'],
    priceRange:{min:30,max:75,currency:'USD'} };
  const native = {...pair.native, lat: 1, lng: 2, startTime: '18:00', lineup:['Native Fixture Support']};
  const before = structuredClone(native);
  const expected = await processConcerts([provider], DB, NOW);
  assert.equal(expected[0].city, 'Valley Center');
  for (const input of [[provider,native],[native,provider]]) {
    assert.deepEqual(await processConcerts(input, DB, NOW), expected, 'Winner is the whole provider record, not combined fields');
  }
  assert.deepEqual(native,before);
});

test('pair boundary rejects new dates/artists/countries/sources, unsafe or different native URLs, moved and unknown venues', async () => {
  const {pairs} = await fixture();
  const pair = pairs.find(p => p.native.date === '2027-02-11')!;
  const [native] = await processConcerts([pair.native], DB, NOW);
  const identity = verifiedOfficialSourceEventIdentity(pair.native,native);
  assert.equal(identity?.dedupeCity,'Valley Center');
  assert.equal(identity?.sourceRank,1);
  assert.equal(verifiedOfficialSourceEventIdentity(pair.provider,pair.provider)?.sourceRank,2);
  const changes = [
    {date:'2028-02-11'}, {artist:'Other Artist'}, {country:'CA'}, {city:'San Diego'},
    {venue:'Explicitly Relocated Venue'}, {venue:'Unknown Venue'},
    {originalSource:'www.blueoctober.com.evil.example'},
    {sourceEventUrl:'https://www.blueoctober.com/tour-dates-detail/different-event'},
    {sourceEventUrl:'https://evil.example/tour-dates-detail/harrah%E2%80%99s-resort-southern-california'},
    {sourceEventUrl:pair.native.sourceEventUrl+'?unverified=1'},
    {sourceEventUrl:pair.native.sourceEventUrl+'#different'},
  ];
  for (const change of changes) {
    const input = {...pair.native,...change};
    const output = {...native,...change};
    assert.equal(verifiedOfficialSourceEventIdentity(input,output),undefined, JSON.stringify(change));
  }
  assert.equal(verifiedOfficialSourceEventIdentity(pair.native,{...native,spotifyId:'DifferentIdentity'}),undefined);
  for (const change of [{venue:'Other Events Center'},{originalSource:'venue.example'},{city:'Funner'},{country:'CA'}]) {
    const input = {...pair.provider,...change};
    assert.equal(verifiedOfficialSourceEventIdentity(input,input),undefined);
  }
});

test('unknown venue does not inherit a provider winner or a city alias; existing conflict behavior remains', async () => {
  const {pairs} = await fixture();
  const funner = pairs.find(p => p.native.date === '2027-02-11')!;
  const unknown = {...funner.native, venue:'Explicitly Relocated Venue'};
  for (const input of [[unknown,funner.provider],[funner.provider,unknown]]) {
    const result = await processConcerts(input,DB,NOW);
    assert.equal(result.length,2, 'Different original city keys stay unresolved without exact venue proof');
    assert.ok(result.some(row => row.venue === unknown.venue && row.city === 'Funner'));
  }
  const abilene = pairs[0];
  const moved = {...abilene.native,venue:'Explicitly Relocated Venue'};
  const [movedAlone] = await processConcerts([moved],DB,NOW);
  assert.equal(verifiedOfficialSourceEventIdentity(moved,movedAlone),undefined);
  assert.deepEqual(await processConcerts([moved,abilene.provider],DB,NOW),[movedAlone],
    'A new/moved venue cannot inherit provider rank; preserve the existing whole-record conflict policy');
});

test('twenty-nine primary-complete Teenage records preserve Bruges source-only and all provider metadata in both orders', async () => {
  const teen = JSON.parse(await readFile('tests/fixtures/teenage-fanclub-event-pairs-20261011.json','utf8')) as {
    pairs: Pair[]; allRaw: RawConcert[];
  };
  const {pairs:blue,baseline} = await fixture();
  const native = teen.pairs.map(p=>p.native);
  const only = await processConcerts(teen.allRaw,DB,NOW);
  assert.equal(teen.allRaw.length,41);
  assert.equal(only.length,29,'Unknown primary-country cohort is not declared recovered');
  assert.equal(only.find(row=>row.date==='2026-10-24')?.city,'Bruges');
  assert.ok(only.every(row=>['ES','FR','BE','DE','NL','GB','IE'].includes(row.country)));
  const expected = records(await processConcerts(baseline,DB,NOW));
  for (const input of [[...baseline,...native],[...native,...baseline],
    [...blue.map(p=>p.native),...teen.allRaw,...baseline],[...baseline,...teen.allRaw,...blue.map(p=>p.native)]]) {
    assert.deepEqual(records(await processConcerts(input,DB,NOW)),expected,
      'Confirmed Cactus event/city alias and finite venue pairs must preserve whole existing records');
  }
  const cactus = teen.pairs.find(p=>p.native.city==='Bruges')!;
  const output = only.find(row=>row.date==='2026-10-24')!;
  assert.equal(verifiedOfficialSourceEventIdentity(cactus.native,output)?.dedupeCity,'Brugge');
  for (const change of [{venue:'Moved Cactus Event'},{city:'Newcastle'},{country:'NL'},{date:'2027-10-24'},
    {sourceEventUrl:'https://teenage.fanclub.tickets.cactusmusic.be/other'},
    {sourceEventUrl:'https://teenage.fanclub.tickets.cactusmusic.be.evil.example/selection'}]) {
    assert.equal(verifiedOfficialSourceEventIdentity({...cactus.native,...change},{...output,...change}),undefined);
  }
});


test('Newcastle exact event alias preserves peer metadata; Amsterdam and Belfast/Dublin country boundaries remain explicit', async () => {
  const teen = JSON.parse(await readFile('tests/fixtures/teenage-fanclub-event-pairs-20261011.json','utf8')) as {
    pairs: Pair[]; allRaw: RawConcert[];
  };
  const newcastle = teen.pairs.find(p=>p.native.date==='2026-11-10')!;
  const [native] = await processConcerts([newcastle.native],DB,NOW);
  assert.equal(native.city,'Newcastle');
  assert.equal(native.venue,'Boiler Shop');
  assert.equal(verifiedOfficialSourceEventIdentity(newcastle.native,native)?.dedupeCity,'Newcastle Upon Tyne');
  const expected = await processConcerts([newcastle.provider],DB,NOW);
  for(const rows of [[newcastle.native,newcastle.provider],[newcastle.provider,newcastle.native]]) {
    assert.deepEqual(await processConcerts(rows,DB,NOW),expected);
  }
  for(const change of [{date:'2027-11-10'},{venue:'Moved Boiler Shop Event'},{city:'Newcastle Upon Tyne'},
    {sourceEventUrl:'https://www.seetickets.com/event/teenage-fanclub/boiler-shop/other'}]) {
    assert.equal(verifiedOfficialSourceEventIdentity({...newcastle.native,...change},{...native,...change}),undefined);
  }
  const amsterdam=teen.allRaw.find(row=>row.city==='Amsterdam' && row.date==='2026-11-01')!;
  assert.equal(amsterdam.venue,undefined,'Artist/operator placement contradiction is retained as unresolved raw');
  assert.deepEqual(await processConcerts([amsterdam],DB,NOW),[]);
  assert.ok(!teen.pairs.some(p=>p.native.date===amsterdam.date),'No priority/pair registry for disputed Amsterdam');
  const forced={...amsterdam,venue:'Paradiso'};
  const [forcedPublic]=await processConcerts([forced],DB,NOW);
  assert.equal(verifiedOfficialSourceEventIdentity(forced,forcedPublic),undefined,'No invented proof even if a raw venue is supplied');
  const {baseline}=await fixture();
  const peer=baseline.find(row=>row.artist==='Teenage Fanclub' && row.date==='2026-11-01')!;
  const peerOnly=await processConcerts([peer],DB,NOW);
  for(const rows of [[amsterdam,peer],[peer,amsterdam]]) {
    assert.deepEqual(await processConcerts(rows,DB,NOW),peerOnly,'Do not override peer placement or coordinates with disputed official row');
  }
  for(const [date,country] of [['2026-11-16','GB'],['2026-11-17','IE']]) {
    const pair=teen.pairs.find(p=>p.native.date===date)!;
    assert.equal(pair.native.country,country);
    const [published]=await processConcerts([pair.native],DB,NOW);
    assert.equal(published.country,country);
    assert.ok(verifiedOfficialSourceEventIdentity(pair.native,published));
    const wrongCountry=country==='GB'?'IE':'GB';
    assert.equal(verifiedOfficialSourceEventIdentity({...pair.native,country:wrongCountry},{...published,country:wrongCountry}),undefined);
  }
});
