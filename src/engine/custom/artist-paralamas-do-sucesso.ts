import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing, isRetryableError } from '../runner.js';
import { sleep } from '../sleep.js';

const ARCHIVE = 'https://www.osparalamas.com.br/evento/';
const HOST = 'www.osparalamas.com.br';
const MAX_PAGES = 12;
const MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', 'março': '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

type Page = { concerts: Partial<Concert>[]; keys: string[]; next?: string };

function archivePageUrl(page: number): string {
  return page === 1 ? ARCHIVE : `${ARCHIVE}page/${page}/`;
}

function firstPartyUrl(value: string | undefined, base: string): string {
  if (!value) throw new Error('Paralamas official event or pagination link is missing');
  const parsed = new URL(value, base);
  if (parsed.protocol !== 'https:' || parsed.hostname !== HOST || parsed.username || parsed.password ||
      parsed.search || parsed.port) {
    throw new Error('Paralamas official calendar points outside its first-party archive');
  }
  return parsed.href;
}

function parseDate(raw: string): string {
  const match = /^(\d{1,2}) de ([a-zç]+) de (20\d{2})$/i.exec(raw);
  const month = match && MONTHS[match[2].toLowerCase()];
  if (!match || !month) throw new Error('Paralamas official calendar event has an invalid date');
  const date = `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Paralamas official calendar event has an impossible date');
  }
  return date;
}

function eventRows(config: ScraperConfig, html: string, scrapedAt: string):
    {concerts: Partial<Concert>[]; keys: string[]} {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  const keys: string[] = [];
  $('li.event').each((_, element) => {
    const block = $(element);
    const date = parseDate(block.find('.event-line-node').first().text().replace(/\s+/g, ' ').trim());
    const detailUrl = firstPartyUrl(block.find('a.event-link[href]').first().attr('href'), config.url);
    const detail = new URL(detailUrl);
    if (!/^\/evento\/[^/]+\/$/.test(detail.pathname)) {
      throw new Error('Paralamas calendar row has an invalid event detail URL');
    }
    detail.hash = '';
    keys.push(detail.href);
    const rawLocation = block.find('.event-line-node.medium').first().text().replace(/\s+/g, ' ').trim();
    const location = /^(.+?)\s+\([A-Z]{2}\),\s+(.+)$/.exec(rawLocation);
    if (!location) {
      // Official ship events have no concert city. Preserve the existing exclusion,
      // while rejecting an unrecognized malformed land event instead of hiding it.
      if (/^Navio\b/i.test(rawLocation) && /Comprar Cabine/i.test(block.text())) return;
      throw new Error('Paralamas official concert row has no complete city and venue');
    }
    concerts.push({
      artist: config.selectors?.artistNameFallback || 'Os Paralamas do Sucesso', date,
      venue: location[2].trim(), city: location[1].trim(), country: 'BR',
      ticketUrl: detailUrl, originalSource: config.domain, scrapedAt
    });
  });
  if (keys.length === 0) throw new Error('Paralamas official calendar page has no event rows');
  return { concerts, keys };
}

/** Date and location parsing of a saved official page, independent of pagination. */
export function parseEventRows(config: ScraperConfig, html: string, scrapedAt: string): Partial<Concert>[] {
  return eventRows(config, html, scrapedAt).concerts;
}

function parsePage(config: ScraperConfig, html: string, scrapedAt: string, page: number): Page {
  const $ = cheerio.load(html);
  const expected = archivePageUrl(page);
  const canonical = $('link[rel="canonical"]');
  if (config.url !== ARCHIVE || config.domain !== HOST ||
      config.selectors?.artistNameFallback !== 'Paralamas do Sucesso' ||
      canonical.length !== 1 || firstPartyUrl(canonical.attr('href'), expected) !== expected) {
    throw new Error('Paralamas official paginated archive identity is missing');
  }
  const title = $('head > title').text().replace(/\s+/g, ' ').trim();
  const pageTitle = /^Arquivo Events - Página (\d+) de (\d+) - Os Paralamas do Sucesso$/.exec(title);
  if (page === 1 ? title !== 'Arquivo Events - Os Paralamas do Sucesso'
      : !pageTitle || Number(pageTitle[1]) !== page || Number(pageTitle[2]) < page) {
    throw new Error('Paralamas official paginated archive title is missing');
  }
  const rows = eventRows(config, html, scrapedAt);
  const nextLinks = $('link[rel="next"]');
  const nextAnchors = $('a').filter((_, node) => $(node).text().replace(/\s+/g, ' ').trim() === 'Next Events »');
  if (nextLinks.length > 1 || nextAnchors.length > 1 || nextLinks.length !== nextAnchors.length) {
    throw new Error('Paralamas official archive pagination links disagree');
  }
  const next = nextLinks.length ? firstPartyUrl(nextLinks.attr('href'), expected) : undefined;
  if (next && (next !== archivePageUrl(page + 1) ||
      firstPartyUrl(nextAnchors.attr('href'), expected) !== next)) {
    throw new Error('Paralamas official archive pagination does not advance one page');
  }
  if (pageTitle && Boolean(next) !== (page < Number(pageTitle[2]))) {
    throw new Error('Paralamas official archive page count and pagination disagree');
  }
  return { ...rows, next };
}

async function fetchNext(url: string, config: ScraperConfig,
  fetchPage: (url: string) => Promise<string>): Promise<string> {
  const retries = config.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    await sleep(attempt === 0 ? config.requestDelayMs ?? 500 : Math.min(15000, 500 * 2 ** (attempt - 1)));
    try { return await fetchPage(url); } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) throw error;
    }
  }
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url, 'got-scraping')):
    Promise<Partial<Concert>[]> {
  const concerts: Partial<Concert>[] = [];
  const keys = new Set<string>();
  let body = html;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = parsePage(config, body, scrapedAt, page);
    for (const key of parsed.keys) {
      if (keys.has(key)) throw new Error('Paralamas official archive repeats an event or page');
      keys.add(key);
    }
    concerts.push(...parsed.concerts);
    if (!parsed.next) return concerts;
    if (page === MAX_PAGES) throw new Error('Paralamas official archive exceeds safe pagination limit');
    body = await fetchNext(parsed.next, config, fetchPage);
  }
  throw new Error('Paralamas official archive is incomplete');
}
