import test from 'node:test';
import assert from 'node:assert/strict';
import { measure } from '../src/scripts/ru_data_expansion_replay.js';

const clock = '2026-10-16T00:00:00.000Z';
const lastRun = '2026-10-16T09:12:22.120Z';
const row = (date: string, city = 'Antalya', country = 'TR', scrapedAt = lastRun) =>
  ({ artist: 'fixture artist', date, city, country, venue: 'fixture venue', scrapedAt });

test('measurement includes day 14 and 90, separates future from all dates and uses lastRun freshness', () => {
  const result = measure([
    row('2026-10-15'), row('2026-10-16'), row('2026-10-29'), row('2026-10-30'),
    row('2027-01-14'), row('2027-01-15'),
    row('2026-11-01', 'Antalya', 'TR', '2026-10-13T09:12:22.120Z'),
    row('2026-11-02', 'Antalya', 'TR', '2026-10-13T09:12:22.119Z'),
    row('2026-11-03', 'Antalya', 'TR', 'unknown')
  ], lastRun, clock);
  assert.equal(result.start, '2026-10-30'); assert.equal(result.end, '2027-01-14');
  assert.deepEqual(result.basket, { allDates: 9, future: 8, window: 5, windowFresh72h: 3 });
});

test('exact alias mapping never joins Antalya/Alanya, Bangkok/Phuket or Jakarta/Bali', () => {
  const result = measure([
    row('2026-11-01'), row('2026-11-01', 'Alanya'), row('2026-11-01', 'Анталья'),
    row('2026-11-01', 'Bangkok', 'TH'), row('2026-11-01', 'Phuket', 'TH'),
    row('2026-11-01', 'Tambon Choeng Thale', 'TH'), row('2026-11-01', 'Jakarta', 'ID')
  ], lastRun, clock);
  for (const [city, count] of [['Antalya', 2], ['Alanya', 1], ['Bangkok', 1], ['Phuket', 1], ['Bali', 0]] as const)
    assert.equal(result.resorts.find(r => r.city === city)!.window, count);
  assert.equal(result.exactFour.windowFresh72h, 2);
  assert.ok(result.unmatchedCityStrings.TH.includes('Tambon Choeng Thale'));
});

test('editorial capacity counts unique names per exact city/ISO-week and exposes timestamp anomalies', () => {
  const result = measure([
    { ...row('2026-12-31'), artist: 'A' }, { ...row('2026-12-31'), artist: 'A' },
    { ...row('2027-01-01'), artist: 'B' }, { ...row('2027-01-02'), artist: 'C' },
    row('2026-11-01', 'Bangkok', 'TH', '2026-10-17T00:00:00Z')
  ], lastRun, clock);
  assert.equal(result.editorialCapacity.byWeek['2026-W53'], 1);
  assert.equal(result.editorialCapacity.triples, 1);
  assert.equal(result.futureScrapedAt.length, 1);
});
