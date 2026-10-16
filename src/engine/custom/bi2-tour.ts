import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

// No JSON-LD/Next data: city is embedded in bilingual product titles, while
// country is only in the corresponding package title. Standard selectors cannot
// perform this exact date/city/location join or distinguish tickets from add-ons.
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (config.url !== 'https://tix.bi2.band/' || config.domain !== 'tix.bi2.band' ||
      clean($('#tt-listings-title').text()) !== 'Bi-2 / Би-2') {
    throw new Error('Bi-2 official ticket calendar identity is missing');
  }
  const records = $('.events-listing__item').map((_, element) => {
    const row = $(element);
    const values = row.find('.event-meta__date var').map((__, e) => clean($(e).text())).get();
    const spans = row.find('.event-meta__date span').map((__, e) => clean($(e).text())).get();
    const month = MONTHS.indexOf(spans[1]) + 1;
    const date = `${values[1]}-${String(month).padStart(2, '0')}-${String(values[0]).padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !month ||
        !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Bi-2 ticket calendar has an unverified full date');
    }
    return { title: clean(row.find('.event__title').text()), date, startTime: values[2],
      location: clean(row.find('.event-meta__location').text()), href: row.find('a.event__link').attr('href') };
  }).get();
  const concerts: Partial<Concert>[] = [];
  for (const record of records) {
    const main = /^Би-2 в .+? \/ Bi-2 in (.+?) \(\d+\+\)$/.exec(record.title);
    if (!main) {
      if (/^Meet & Greet Package Bi-2 .+ \([A-Z]{2}\)$/.test(record.title) ||
          record.title === 'Gift Certificate — Bi-2 Fan Club') continue;
      throw new Error('Bi-2 ticket calendar has an unverified product type');
    }
    const city = main[1];
    const peers = records.filter(peer => peer.date === record.date && peer.location === record.location &&
      peer.title.startsWith(`Meet & Greet Package Bi-2 ${city} (`));
    const countries = new Set(peers.map(peer => /\(([A-Z]{2})\)$/.exec(peer.title)?.[1]).filter(Boolean));
    if (countries.size !== 1) throw new Error('Bi-2 concert country lacks an exact package/date/location match');
    const nativeCountry = [...countries][0]!;
    const country = nativeCountry === 'UK' ? 'GB' : nativeCountry;
    const venue = record.location.split(',')[0].trim();
    if (!venue || !record.href || !/^\/events\/bi2\/\d+$/.test(record.href) ||
        !/^\d{2}:\d{2}$/.test(record.startTime || '')) {
      throw new Error('Bi-2 concert venue, time or event URL is missing');
    }
    concerts.push({ artist: 'Би-2', date: record.date, startTime: record.startTime,
      venue, city, country, ticketUrl: new URL(record.href, config.url).href,
      originalSource: config.domain, scrapedAt });
  }
  return concerts;
}
