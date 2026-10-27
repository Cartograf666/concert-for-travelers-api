import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';
import { sleep } from '../sleep.js';

const URL = 'https://bespoketouring.oztix.com.au/';
const BILLING = /^Hard-Ons with Jerry A(?:\s*[—–-]\s*.+)?$/i;
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function parseItinerary(config: ScraperConfig, html: string, scrapedAt: string): Partial<Concert>[] {
  const $ = cheerio.load(html);
  const canonical = $('link[rel="canonical"]').attr('href');
  if (!canonical || !/^https:\/\/bespoketouring\.oztix\.com\.au\/outlet\/event\/[a-f0-9-]+$/.test(canonical)) {
    throw new Error('Hard-Ons organizer event identity missing');
  }
  const events = $('script[type="application/ld+json"]').toArray().flatMap(node => {
    const value = JSON.parse($(node).text());
    return value['@graph'] ?? [value];
  }).filter(event => event['@type'] === 'Event' && BILLING.test(event.name ?? ''));
  if (events.length !== 1) throw new Error('Hard-Ons band billing missing or ambiguous');
  const event = events[0];
  if (/EventCancelled|EventPostponed/.test(event.eventStatus ?? '')) throw new Error('Hard-Ons event cancelled or postponed; itinerary requires revalidation');
  if (event.eventStatus !== 'https://schema.org/EventScheduled' || event.url !== canonical ||
      event.location?.address?.addressCountry !== 'Australia') throw new Error('Hard-Ons event status or country changed');
  const description = $('.event-description').clone();
  description.find('br').replaceWith('\n');
  const lines = description.text().split('\n').map(clean).filter(Boolean);
  if (lines[0] !== 'HARD-ONS WITH JERRY A') throw new Error('Hard-Ons description identity missing');
  const header = /^AUSTRALIAN TOUR ([A-Z]+) (20\d{2})$/.exec(lines[1] ?? '');
  if (!header || !MONTHS.includes(header[1])) throw new Error('Hard-Ons Australian tour year missing');
  const rows: Partial<Concert>[] = [];
  const dates = new Set<string>();
  for (const line of lines) {
    const match = /^([A-Za-z]+) (\d{1,2}) - (.+), ([^,]+)$/.exec(line);
    if (!match) {
      if (/^[A-Za-z]+ \d+\s*[-–]/.test(line)) throw new Error('Hard-Ons malformed itinerary row');
      continue;
    }
    if (/\b(cancelled|canceled|postponed)\b/i.test(line)) continue;
    const month = MONTHS.indexOf(match[1].toUpperCase()) + 1;
    const date = `${header[2]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    if (!month || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Hard-Ons impossible tour date');
    if (dates.has(date)) throw new Error('Hard-Ons ambiguous multiple stops on one date');
    dates.add(date);
    const isThisEvent = String(event.startDate).slice(0, 10) === date;
    if (isThisEvent && (!event.location.name || !event.location.address.addressLocality)) throw new Error('Hard-Ons dedicated event location missing');
    rows.push({ artist: 'Hard-Ons', date, venue: isThisEvent ? event.location.name : match[3],
      city: isThisEvent ? event.location.address.addressLocality : match[4], country: 'AU',
      // The Perth sale page is not a ticket link for the rest of the itinerary.
      ...(isThisEvent ? { ticketUrl: canonical, eventUrl: canonical } : {}), originalSource: config.domain, scrapedAt });
  }
  if (!rows.length) throw new Error('Hard-Ons itinerary empty or changed');
  return rows;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url)): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (config.url !== URL || config.domain !== 'bespoketouring.oztix.com.au' ||
      config.selectors?.artistNameFallback !== 'Hard-Ons' || !/Bespoke Touring ticket sales/.test($('title').text())) {
    throw new Error('Hard-Ons organizer catalog identity missing');
  }
  const links = new Set<string>();
  $('.event').each((_, node) => {
    const block = $(node), anchor = block.find('h3 a[itemprop="name"]');
    if (!BILLING.test(clean(anchor.text()))) return;
    if (!/^Damaged presents$/i.test(clean(block.find('.tsPresentedByText').text()))) throw new Error('Hard-Ons promoter identity missing');
    const url = new globalThis.URL(anchor.attr('href') ?? '', URL);
    if (url.origin !== new globalThis.URL(URL).origin || url.pathname !== '/Default.aspx' ||
        !/^\?Event=\d+$/.test(url.search) || url.hash) throw new Error('Hard-Ons invalid organizer event link');
    links.add(url.href);
  });
  if (!links.size || links.size > 20) throw new Error('Hard-Ons organizer catalog empty or exceeds fetch limit');
  const rows = new Map<string, Partial<Concert>>();
  for (const url of links) {
    await sleep(config.requestDelayMs ?? 500);
    const body = await fetchPage(url);
    for (const row of parseItinerary(config, body, scrapedAt)) {
      const key = `${row.date}|${row.artist}`;
      const existing = rows.get(key);
      // A dedicated event page has stronger venue/locality evidence than the itinerary text.
      if (!existing || row.eventUrl) rows.set(key, row);
    }
  }
  return [...rows.values()];
}
