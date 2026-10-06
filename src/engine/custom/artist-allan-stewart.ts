import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';

const BIG_SHOW_URL = 'https://www.capitaltheatres.com/shows/allan-stewarts-big-big-variety-show/';
const PINOCCHIO_URL = 'https://www.capitaltheatres.com/shows/pinocchio/';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function discoverCurrentShows(html: string, scrapedAt: string): { pinocchioListed: boolean } {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!/UPCOMING SHOWS\s*\|\s*allanstewart/i.test($('title').text()) ||
      !canonical || !/^https:\/\/www\.allanstewart\.com\/shows\/?$/.test(canonical)) {
    throw new Error('Allan Stewart official current-shows identity is missing');
  }
  const headings = $('h2, h5').toArray();
  const start = headings.findIndex(node => clean($(node).text()) === 'UPCOMING SHOWS');
  if (start < 0) throw new Error('Allan Stewart current-shows section is missing');
  const currentYear = new Date(scrapedAt).getUTCFullYear();
  const current: string[] = [];
  for (const node of headings.slice(start + 1)) {
    const text = clean($(node).text());
    const printedYears = [...text.matchAll(/\b20\d{2}\b/g)].map(match => Number(match[0]));
    if (printedYears.length > 0 && printedYears.every(year => year < currentYear)) break;
    if (node.tagName === 'h5') current.push(text);
  }
  const big = current.filter(text => /^Allan Stewart['’]s Big Big Variety Show\b/i.test(text));
  const pinocchio = current.filter(text => /^Pinocchio\b/i.test(text));
  const wizard = current.filter(text => /^The Wizard of Oz \(UK TOUR\)/i.test(text));
  if (big.length !== 1 || pinocchio.length > 1 || wizard.length > 1 ||
      current.length !== big.length + pinocchio.length + wizard.length) {
    throw new Error(`Allan Stewart current show list changed: ${current.join(' | ')}`);
  }
  if (!/Kings Theatre, Edinburgh/i.test(big[0])) {
    throw new Error('Allan Stewart headline show has no verified Edinburgh venue');
  }
  const links = $('a[href]').map((_, node) => $(node).attr('href')).get();
  const legacyHeadlineLink = 'https://www.capitaltheatres.com/whats-on/allan-stewarts-big-big-variety-show';
  if ((pinocchio.length > 0 && !links.includes(PINOCCHIO_URL)) ||
      (!links.includes(legacyHeadlineLink) && !links.includes(BIG_SHOW_URL))) {
    throw new Error('Allan Stewart current shows lack observed Capital Theatres discovery links');
  }
  return { pinocchioListed: pinocchio.length > 0 };
}

function verifyPinocchioRole(html: string): void {
  const $ = cheerio.load(html);
  const role = clean($('main').text() || $('body').text());
  if ($('link[rel="canonical"]').attr('href') !== PINOCCHIO_URL ||
      !/The Adventures of Pinocchio/i.test($('title').text()) ||
      !/Allan Stewart as May Geppetto/i.test(role) || !/\bpanto(?:mime)?\b/i.test(role)) {
    throw new Error('Allan Stewart Pinocchio cast-role exclusion is no longer verified');
  }
}

function printedDate(monthCode: string, printed: string): string {
  const month = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(monthCode);
  const parts = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}) ([A-Za-z]{3})$/.exec(printed);
  if (!month || !parts) throw new Error(`Allan Stewart show has incomplete printed date: ${monthCode} / ${printed}`);
  const year = Number(month[1]);
  const monthIndex = Number(month[2]) - 1;
  const day = Number(parts[2]);
  const calendar = new Date(Date.UTC(year, monthIndex, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== monthIndex || calendar.getUTCDate() !== day ||
      MONTHS[monthIndex] !== parts[3] || WEEKDAYS[calendar.getUTCDay()] !== parts[1]) {
    throw new Error(`Allan Stewart show has invalid calendar date: ${monthCode} / ${printed}`);
  }
  return `${year}-${month[2]}-${String(day).padStart(2, '0')}`;
}

function printedTime(value: string): string {
  const match = /^(1[0-2]|[1-9])(?::([0-5]\d))?(am|pm)$/i.exec(value);
  if (!match) throw new Error(`Allan Stewart show has missing or invalid time: ${value}`);
  const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2] || '00'}`;
}

function parseHeadlineShows(html: string, config: ScraperConfig, scrapedAt: string): Partial<Concert>[] {
  const $ = cheerio.load(html);
  const title = clean($('h1.page-header__heading').text()).replaceAll('’', "'");
  const venue = clean($('header.page-header .venue-logo__list .venue-logo .sr-text').first().text());
  if ($('link[rel="canonical"]').attr('href') !== BIG_SHOW_URL ||
      title !== "Allan Stewart's Big Big Variety Show" || venue !== 'Kings Theatre' ||
      !/King['’]s Theatre, Edinburgh/i.test(clean($('main').text() || $('body').text())) ||
      !/night filled with comedy, music/i.test(clean($('main').text() || $('body').text()))) {
    throw new Error('Allan Stewart headline show identity, venue or city is missing');
  }

  const byTicket = new Map<string, Partial<Concert>>();
  const dates = $('li.event-instance');
  if (dates.length === 0) throw new Error('Allan Stewart headline show has no dated performances');
  dates.each((_, dateNode) => {
    const row = $(dateNode);
    const date = printedDate(row.attr('data-month') || '', clean(row.find('.event-instance__date p.date').first().text()));
    const performances = row.find('li.event-instance__time-list--item');
    if (performances.length === 0) throw new Error(`Allan Stewart show has no timed performance on ${date}`);
    performances.each((_, performanceNode) => {
      const performance = $(performanceNode);
      const startTime = printedTime(clean(performance.find('p.time').first().text()));
      const tickets = new Set(performance.find('.event-instance__booking a[href]').map((_, node) => $(node).attr('href')).get());
      if (tickets.size !== 1) throw new Error(`Allan Stewart show has missing or conflicting booking links on ${date}`);
      const ticketUrl = [...tickets][0];
      if (!/^https:\/\/www\.capitaltheatres\.com\/book-online\/\d+\/?$/.test(ticketUrl)) {
        throw new Error(`Allan Stewart show has unsupported booking URL: ${ticketUrl}`);
      }
      const event: Partial<Concert> = {
        artist: config.selectors?.artistNameFallback || 'Allan Stewart', date, startTime, venue,
        city: 'Edinburgh', country: 'GB', ticketUrl, originalSource: config.domain, scrapedAt
      };
      const duplicate = byTicket.get(ticketUrl);
      if (duplicate && (duplicate.date !== date || duplicate.startTime !== startTime)) {
        throw new Error(`Allan Stewart duplicate booking URL has conflicting date or time: ${ticketUrl}`);
      }
      byTicket.set(ticketUrl, event);
    });
  });
  return [...byTicket.values()];
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const { pinocchioListed } = discoverCurrentShows(html, scrapedAt);
  if (pinocchioListed) {
    const pinocchio = await fetchHtmlForHealing(PINOCCHIO_URL);
    verifyPinocchioRole(pinocchio);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const headline = await fetchHtmlForHealing(BIG_SHOW_URL);
  return parseHeadlineShows(headline, config, scrapedAt);
}
