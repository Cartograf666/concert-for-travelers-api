import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const PAGE = 'https://antoha-mc.ru/concerts';
const CANONICAL = 'http://antoha-mc.ru/concerts';
const ARTIST = 'Антоха МС';
const DATE_ID = '1762508321256';
const CITY_ID = '1762508321260';
const VENUE_ID = '1762508321263';
const TICKET_ID = '1762508349918';
const CITY_COUNTRY: Readonly<Record<string, { city: string; country: string }>> = {
  'москва': { city: 'Москва', country: 'RU' },
  'санкт-петербург': { city: 'Санкт-Петербург', country: 'RU' }
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function dateOf(year: number, raw: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(raw);
  if (!match) throw new Error(`Antoha MC upcoming date is invalid: ${raw}`);
  const date = `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Antoha MC upcoming date is impossible: ${raw}`);
  }
  return date;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (config.url !== PAGE || config.domain !== 'antoha-mc.ru' ||
      config.selectors?.artistNameFallback !== ARTIST ||
      clean($('head > title').text()) !== 'Концерты' ||
      $('link[rel="canonical"]').attr('href') !== CANONICAL ||
      $('#allrecords > .t-rec').length === 0) {
    throw new Error('Antoha MC official concerts page identity is missing');
  }

  const concerts: Partial<Concert>[] = [];
  let year: number | undefined;
  let upcomingRows = 0;
  let filmRows = 0;
  let passedHeading = false;
  let pastRows = 0;
  $('#allrecords > .t-rec').each((_, element) => {
    const record = $(element);
    const atoms = record.find('.t396__artboard .tn-atom');
    const texts = atoms.map((__, node) => clean($(node).text())).get().filter(Boolean);
    if (texts.length === 1 && texts[0].toLowerCase() === 'прошедшие') {
      if (!year || passedHeading) throw new Error('Antoha MC past-events boundary is invalid');
      passedHeading = true;
      return;
    }
    if (passedHeading) {
      if (record.find(`.tn-elem[data-elem-id="${DATE_ID}"]`).length) pastRows++;
      return;
    }
    if (texts.length === 0) return;
    if (texts.length === 1 && /^20\d{2}$/.test(texts[0])) {
      const nextYear = Number(texts[0]);
      if (year && nextYear <= year) throw new Error('Antoha MC upcoming years are not increasing');
      year = nextYear;
      return;
    }
    if (!year) return; // Navigation and the page heading precede the first calendar year.

    const value = (id: string) => clean(record.find(`.tn-elem[data-elem-id="${id}"] .tn-atom`).first().text());
    const date = dateOf(year, value(DATE_ID));
    if (date < scrapedAt.slice(0, 10)) throw new Error(`Antoha MC upcoming section contains a past date: ${date}`);
    const cityRaw = value(CITY_ID);
    const venue = value(VENUE_ID);
    const ticketRaw = record.find(`.tn-elem[data-elem-id="${TICKET_ID}"] a.tn-atom`).first().attr('href');
    if (!cityRaw || !venue || !ticketRaw) throw new Error('Antoha MC upcoming event lacks city, venue or ticket');
    const ticket = new URL(ticketRaw, PAGE);
    if (ticket.protocol !== 'https:' || ticket.username || ticket.password) {
      throw new Error('Antoha MC upcoming event has an unsafe ticket URL');
    }
    upcomingRows++;
    if (venue.toLowerCase() === 'кинопоказ каро/арт') {
      if (ticket.hostname !== 'karofilm.ru' || !/^\/film\/\d+$/.test(ticket.pathname)) {
        throw new Error('Antoha MC screening label and ticket do not agree');
      }
      filmRows++;
      return;
    }
    if (/кино|показ/i.test(venue)) {
      throw new Error(`Antoha MC upcoming event type is unverified: ${venue}`);
    }
    const place = CITY_COUNTRY[cityRaw.toLowerCase()];
    if (!place) throw new Error(`Antoha MC upcoming concert has an unverified city: ${cityRaw}`);
    concerts.push({
      artist: ARTIST, date, venue, city: place.city, country: place.country,
      ticketUrl: ticket.href, originalSource: config.domain, scrapedAt
    });
  });
  if (!passedHeading || pastRows === 0 || upcomingRows === 0 ||
      (concerts.length === 0 && filmRows !== upcomingRows)) {
    throw new Error('Antoha MC current concert section is incomplete');
  }
  return concerts;
}
