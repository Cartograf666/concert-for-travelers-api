import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';

const ORIGIN = 'https://www.jorgeemateus.com.br';
const STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
// These UF codes also name US states. Only Florianópolis/SC is independently
// verified as Brazilian (IBGE city code 4205407); other ambiguous pairs fail closed.
const AMBIGUOUS_STATES = new Set(['AL', 'MA', 'MT', 'MS', 'PA', 'SC']);

function monthUrl(month: number, year: number): string {
  return `${ORIGIN}/wp-json/agenda/v1/eventos/month/${month}/year/${year}`;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function readMonth(raw: string, month: number, year: number, config: ScraperConfig, scrapedAt: string): Partial<Concert>[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error(`Jorge & Mateus ${year}-${month} API is not JSON`); }
  // WordPress serializes an empty result as [] and populated results as a slug-keyed object.
  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    throw new Error(`Jorge & Mateus ${year}-${month} API returned an unexpected array`);
  }
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw new Error(`Jorge & Mateus ${year}-${month} API has no recognized event collection`);
  }
  const rows: Partial<Concert>[] = [];
  for (const [slug, value] of Object.entries(data)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Jorge & Mateus invalid event: ${slug}`);
    const record = value as Record<string, unknown>;
    if (typeof record.agenda_data !== 'string' || typeof record.title !== 'string' ||
        typeof record.agenda_cidade !== 'string' || typeof record.agenda_local !== 'string') {
      throw new Error(`Jorge & Mateus incomplete event fields: ${slug}`);
    }
    const dateMatch = /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.exec(record.agenda_data);
    if (!dateMatch) throw new Error(`Jorge & Mateus invalid printed date: ${slug}`);
    const date = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== Number(dateMatch[3])) throw new Error(`Jorge & Mateus date outside requested calendar month: ${slug}`);
    const title = clean(record.title);
    const cityField = clean(record.agenda_cidade) || title;
    if (record.agenda_cidade && cityField !== title) throw new Error(`Jorge & Mateus city/title mismatch: ${slug}`);
    const location = /^(.+?)\s*\/\s*([A-Z]{2})$/.exec(cityField);
    if (!location || !clean(location[1]) || !STATES.has(location[2])) {
      throw new Error(`Jorge & Mateus unsupported city/state: ${slug}`);
    }
    if (AMBIGUOUS_STATES.has(location[2]) &&
        !(location[2] === 'SC' && clean(location[1]) === 'Florianópolis')) {
      throw new Error(`Jorge & Mateus ambiguous country for city/state: ${slug}`);
    }
    const venue = clean(record.agenda_local).replace(/^\((.*)\)$/, '$1').trim();
    if (!venue || /JORGE E MATEUS|\bDVD\b|\bFESTIVAL\b|GAROTA VIP|MIL SORRISOS|FELICITÁ/i.test(venue)) {
      throw new Error(`Jorge & Mateus missing or non-venue location: ${slug}`);
    }
    rows.push({
      artist: config.selectors?.artistNameFallback || 'Jorge e Mateus',
      date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      venue, city: clean(location[1]), country: 'BR',
      ticketUrl: config.url, originalSource: config.domain, scrapedAt
    });
  }
  return rows;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url, 'got-scraping')): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!/^Agenda - Jorge &(?:amp;| ) Mateus\s*:Jorge &(?:amp;| ) Mateus$/.test($('title').html() || '') ||
      $('link[rel="canonical"]').attr('href') !== `${ORIGIN}/agenda/` ||
      !$('#agenda-page-list').length ||
      !$('script[src]').toArray().some(node => /\/customjs\/page-agenda\.js(?:\?|$)/.test($(node).attr('src') || ''))) {
    throw new Error('Jorge & Mateus official current agenda identity or calendar is missing');
  }
  const now = new Date(scrapedAt);
  if (Number.isNaN(now.getTime())) throw new Error('Jorge & Mateus invalid scrape timestamp');
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const next = new Date(Date.UTC(year, month, 1));
  const first = readMonth(await fetchPage(monthUrl(month, year)), month, year, config, scrapedAt);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const second = readMonth(await fetchPage(monthUrl(next.getUTCMonth() + 1, next.getUTCFullYear())),
    next.getUTCMonth() + 1, next.getUTCFullYear(), config, scrapedAt);
  return [...first, ...second];
}
