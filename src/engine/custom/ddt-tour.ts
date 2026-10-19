import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';

import { normalizeCountry } from '../../pipeline/process.js';

const PAGE = 'https://biletkartina.tv/ru/event/Gruppa_DDT_v_Germanii';
const TITLE = 'Группа ДДТ в Германии';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// The native JSON-LD bills performer Yuri Shevchuk, but the verified official
// DDT tour links to this *band* calendar. Generic JSON-LD prefers performer and
// would publish a different artist. Selectors cannot read its JSON array.
// No fallback country/date/place is used; unknown inventory fails closed.
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  const $ = cheerio.load(html);
  if (config.url !== PAGE || config.domain !== 'biletkartina.tv' ||
      clean($('h1').text()) !== TITLE) throw new Error('DDT calendar identity is missing');
  const nodes: Record<string, any>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const data: unknown = JSON.parse($(el).text());
    const values = Array.isArray(data) ? data : [data];
    for (const value of values) if (value && typeof value === 'object') nodes.push(value);
  });
  const events = nodes.filter(n => n['@type'] === 'MusicEvent');
  if (!events.length) throw new Error('DDT concert type is missing');
  const concerts: RawConcert[] = [];
  for (const event of events) {
    if (event.name !== TITLE || event.performer?.name !== 'Yuri Shevchuk') {
      throw new Error('DDT event identity is unverified');
    }
    if (event.eventStatus !== 'https://schema.org/EventScheduled' ||
        event.eventAttendanceMode !== 'https://schema.org/OfflineEventAttendanceMode') {
      // Cancelled/postponed inventory has no reliable date to publish.
      continue;
    }
    const stamp = event.startDate;
    if (typeof stamp !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/.test(stamp)) {
      throw new Error('DDT concert needs a full date');
    }
    const date = stamp.slice(0, 10);
    const parsed = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
        !Number.isFinite(Date.parse(stamp))) throw new Error('DDT concert has an invalid date');
    const venue = event.location?.name;
    const address = event.location?.address;
    const city = address?.addressLocality;
    if (typeof venue !== 'string' || !venue.trim() || typeof city !== 'string' || !city.trim()) {
      throw new Error('DDT concert place is missing');
    }
    const url = event.url;
    if (typeof url !== 'string' || !url.startsWith(PAGE + '/') ||
        !/^\/[a-z0-9-]+$/.test(url.slice(PAGE.length)) ||
        event.offers?.url !== url || !url.endsWith('-' + date)) {
      throw new Error('DDT source event URL is unverified');
    }
    // Only the card's explicit country is evidence. normalizeCountry preserves
    // unknown names as long strings, so require a verified two-letter result.
    const rawCountry = address?.addressCountry;
    const labels: unknown[] = typeof rawCountry === 'string' ? [rawCountry]
      : rawCountry?.['@type'] === 'Country'
        ? [rawCountry.name, rawCountry.identifier].filter(value => value !== undefined) : [];
    const codes = labels.map(label => typeof label === 'string' ? normalizeCountry(label) : '');
    if (!codes.length || codes.some(code => !/^[A-Z]{2}$/.test(code)) || new Set(codes).size !== 1) continue;
    const country = codes[0];
    if (date < scrapedAt.slice(0, 10)) continue;
    concerts.push({ artist: 'ДДТ', date, startTime: stamp.slice(11, 16), venue: clean(venue),
      city: clean(city), country, ticketUrl: url, sourceEventUrl: url, originalSource: config.domain, scrapedAt });
  }
  return concerts;
}
