import test from 'node:test';
import assert from 'node:assert';
import { normalizeCountry } from '../src/pipeline/process.js';

test('normalizeCountry accepts exact ISO country names beyond the original market subset', () => {
  assert.equal(normalizeCountry('Argentina'), 'AR');
  assert.equal(normalizeCountry('Colombia'), 'CO');
  assert.equal(normalizeCountry('Costa Rica'), 'CR');
});

test('normalizeCountry accepts exact localized country names observed in the live artist cache', () => {
  assert.equal(normalizeCountry('Nederland'), 'NL');
  assert.equal(normalizeCountry('België'), 'BE');
  assert.equal(normalizeCountry('Royaume-Uni'), 'GB');
  assert.equal(normalizeCountry('Allemagne'), 'DE');
  assert.equal(normalizeCountry('Italie'), 'IT');
  assert.equal(normalizeCountry('Norge'), 'NO');
});

test('normalizeCountry preserves country-first nested-city input without inferring city-first locations', () => {
  assert.equal(normalizeCountry('Bulgaria, Plovdiv'), 'BG');
  assert.equal(normalizeCountry('France, Paris'), 'FR');
  assert.equal(normalizeCountry('Berlin, Germany'), 'BERLIN');
  assert.equal(normalizeCountry('Messehalle 4, Frankfurt, Germany, 15234'), 'MESSEHALLE 4');
  assert.equal(
    normalizeCountry('October 16 2026 - Kulttuuritalo, Helsinki - FINLAND'),
    'OCTOBER 16 2026 - KULTTUURITALO'
  );
  assert.equal(normalizeCountry('New York, USA'), 'NEW YORK');
});

test('normalizeCountry recovers duplicated country text without accepting arbitrary repeated text', () => {
  assert.equal(normalizeCountry('United KingdomUnited Kingdom'), 'GB');
  assert.equal(normalizeCountry('GermanyGermany'), 'DE');
  assert.equal(normalizeCountry('Buy TicketsBuy Tickets'), 'BUY TICKETSBUY TICKETS');
});

test('normalizeCountry keeps ambiguous or conflicting mixed locations invalid for strict schema rejection', () => {
  assert.equal(normalizeCountry('Los Angeles, CA'), 'LOS ANGELES');
  assert.equal(normalizeCountry('Portland, OR'), 'PORTLAND');
  assert.equal(normalizeCountry('Atlanta, Georgia'), 'ATLANTA');
  assert.equal(normalizeCountry('Paris, France, Berlin, Germany'), 'PARIS, FRANCE, BERLIN, GERMANY');
  assert.equal(normalizeCountry('US, France, Germany'), 'US, FRANCE, GERMANY');
  assert.equal(normalizeCountry('Buy Tickets'), 'BUY TICKETS');
});

test('normalizeCountry preserves standalone two-letter codes and common standalone aliases', () => {
  assert.equal(normalizeCountry('de'), 'DE');
  assert.equal(normalizeCountry('UK'), 'GB');
  assert.equal(normalizeCountry('U.K.'), 'GB');
});

test('normalizeCountry rejects unknown two-letter fragments observed in the live cache', () => {
  assert.equal(normalizeCountry('po'), '');
  assert.equal(normalizeCountry('KO'), '');
  assert.equal(normalizeCountry('PO, Gdansk'), '');
});
