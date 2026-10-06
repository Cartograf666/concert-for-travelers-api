import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';

export function parseDetail(config: ScraperConfig, html: string, expectedDate: string, url: string, scrapedAt: string): Partial<Concert> {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ');
  const date = text.match(/日程[：:]\s*(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  const place = text.match(/会場[：:]\s*([^\s・]+)・(live music club PADOMA)/);
  if (!date || !place || !text.includes('ゲスト出演')) throw new Error(`Official Yanagi guest detail is missing participation, date or venue: ${url}`);
  const normalizedDate = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
  if (normalizedDate !== expectedDate) throw new Error(`Yanagi event list/detail date mismatch: ${url}`);
  // PADOMA's own access page confirms its Kobe address; do not infer other venues from a prefecture alone.
  if (place[1] !== '兵庫') throw new Error(`Unsupported Yanagi event place: ${url}`);
  return {
    artist: 'Yanagi Nagi', date: normalizedDate, venue: place[2], city: 'Kobe', country: 'JP',
    ticketUrl: url, originalSource: config.domain, scrapedAt
  };
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = fetchHtmlForHealing): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const rows: Partial<Concert>[] = [];
  const today = scrapedAt.slice(0, 10);
  for (const element of $('.c-live_list__item').toArray()) {
    const block = $(element);
    const dateMatch = block.find('.c-live_list__date-period').first().text().match(/(20\d{2})\.(\d{2})\.(\d{2})/);
    if (!dateMatch) continue;
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    if (date < today) continue;
    const href = block.find('a.c-live_list__link').attr('href');
    if (!href) throw new Error(`Future Yanagi listing is missing detail URL: ${date}`);
    const url = new URL(href, config.url);
    if (url.protocol !== 'https:' || url.hostname !== 'yanaginagi.net') throw new Error(`Unexpected Yanagi detail host: ${url.href}`);
    rows.push(parseDetail(config, await fetchPage(url.href), date, url.href, scrapedAt));
  }
  return rows;
}
