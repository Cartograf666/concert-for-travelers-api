import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';
import { sleep } from '../sleep.js';
import { safeAbsoluteUrl } from '../url.js';

type Row = {contentsSeq?: unknown; spaceCd?: unknown; title?: unknown; startDt?: unknown; homepageUrl?: unknown};
function pageData(body: string): {rows: Row[]; total: number} {
  const data = JSON.parse(body)?.showListInfo;
  if (!data || !Array.isArray(data.showList) || !Number.isInteger(data.totalCount) || data.totalCount < 0) {
    throw new Error('Sangsangmadang schedule payload is unavailable');
  }
  return {rows: data.showList, total: data.totalCount};
}

/** First-party feed used by the venue's /show/list widget, scoped to Hongdae. */
export async function scrape(config: ScraperConfig, body: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = fetchHtmlForHealing): Promise<Partial<Concert>[]> {
  const first = pageData(body);
  const rows = [...first.rows];
  const ids = new Set(rows.map((row) => row.contentsSeq));
  const pageSize = first.rows.length;
  if (first.total > 240 || (first.total > 0 && pageSize === 0)) throw new Error('Sangsangmadang schedule is incomplete');
  for (let page = 2; rows.length < first.total; page++) {
    const url = new URL(config.url);
    url.searchParams.set('page', String(page));
    await sleep(config.requestDelayMs ?? 500);
    const next = pageData(await fetchPage(url.href));
    if (next.total !== first.total || next.rows.length === 0) throw new Error('Sangsangmadang schedule changed during pagination');
    for (const row of next.rows) {
      if (ids.has(row.contentsSeq)) throw new Error('Sangsangmadang schedule repeats a page');
      ids.add(row.contentsSeq);
      rows.push(row);
    }
  }
  if (rows.length !== first.total || ids.size !== rows.length) throw new Error('Sangsangmadang schedule count mismatch');
  return rows.map((row) => {
    if (row.spaceCd !== 'HD' || !Number.isInteger(row.contentsSeq) || typeof row.title !== 'string' ||
        typeof row.startDt !== 'string' || !/^20\d{6}$/.test(row.startDt)) throw new Error('Sangsangmadang event has invalid identity or date');
    const date = `${row.startDt.slice(0, 4)}-${row.startDt.slice(4, 6)}-${row.startDt.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Sangsangmadang event has an invalid calendar date');
    const title = cheerio.load(`<span>${row.title}</span>`).text().replace(/\s+/g, ' ').trim();
    const artist = title.split(/\s+(?:단독\s+)?콘서트/)[0];
    if (!artist) throw new Error('Sangsangmadang event has no performer');
    return {
      artist, date, venue: config.selectors?.venueNameFallback, city: config.selectors?.cityNameFallback,
      country: config.selectors?.countryNameFallback, lat: config.selectors?.lat, lng: config.selectors?.lng,
      ticketUrl: typeof row.homepageUrl === 'string' && row.homepageUrl ? safeAbsoluteUrl(row.homepageUrl, config.url)
        : new URL(`/show/detail/${row.contentsSeq}`, config.url).href,
      originalSource: config.domain, scrapedAt
    };
  });
}
