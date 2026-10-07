import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';

const PAGE = 'https://kawashimaai.com/live';
const ARTIST = 'Ai Kawashima';
const JP_WEEKDAYS = '日月火水木金土';
// The source lists prefectures, not cities. Only these exact venues have a
// municipality independently confirmed by the venue or local tourism authority.
// https://www.aeontown.co.jp/yukarigaoka/access/
// https://www.tokaikanko.com/play/place/ooyanehiroba/
const VERIFIED_VENUES = new Map([
  ['イオンタウンユーカリが丘', { prefecture: '千葉', city: 'Sakura', link: 'https://www.aeontown.co.jp/yukarigaoka/' }],
  ['太田川駅前 大屋根広場', { prefecture: '愛知', city: 'Tokai', link: null }]
]);

function dateFromNative(raw: string): string {
  const match = /^(20\d{2})\/(\d{1,2})\/(\d{1,2})\s*[（(]([日月火水木金土])[）)]$/.exec(raw.trim());
  if (!match) throw new Error('Ai Kawashima invalid native date');
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
      JP_WEEKDAYS[parsed.getUTCDay()] !== match[4]) throw new Error('Ai Kawashima inconsistent native date');
  return date;
}

function detailVenue($: cheerio.CheerioAPI): { name: string; link?: string } {
  const found: { name: string; link?: string }[] = [];
  $('#live_detail article .text_area p').each((_, element) => {
    const paragraph = $(element).clone();
    paragraph.find('br').replaceWith('\n');
    for (const line of paragraph.text().split('\n')) {
      const match = /^\s*📍\s*(.+?)\s*$/.exec(line);
      if (match) found.push({ name: match[1], link: $(element).find('a').first().attr('href') });
    }
  });
  if (found.length !== 1) throw new Error('Ai Kawashima native venue missing or ambiguous');
  return found[0];
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url, 'axios')): Promise<Partial<Concert>[]> {
  if (config.url !== PAGE || config.domain !== 'kawashimaai.com' ||
      config.selectors?.artistNameFallback !== ARTIST) {
    throw new Error('Ai Kawashima official source identity mismatch');
  }
  if (!/^20\d{2}-\d{2}-\d{2}T/.test(scrapedAt)) throw new Error('Ai Kawashima invalid scrape timestamp');
  const $ = cheerio.load(html);
  if ($('head > title').text().trim() !== 'LIVE | 川嶋あい My Room') {
    throw new Error('Ai Kawashima official calendar identity missing');
  }
  const rows = $('#live_index table tr').toArray();
  if (!rows.length) throw new Error('Ai Kawashima official calendar rows missing');
  const concerts: Partial<Concert>[] = [];
  for (const row of rows) {
    const date = dateFromNative($(row).find('th.date').text());
    if (date < scrapedAt.slice(0, 10)) continue;
    const prefecture = $(row).find('td.place span').text().trim();
    const title = $(row).find('td.text a').text().trim();
    const rawUrl = $(row).find('td.text a').attr('href');
    if (!prefecture || !title || !rawUrl) throw new Error('Ai Kawashima incomplete calendar row');
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'kawashimaai.com' ||
        !url.pathname.startsWith('/live/') || url.pathname === '/live/' ||
        url.search || url.hash || url.username || url.password || url.port) {
      throw new Error('Ai Kawashima unsafe native detail URL');
    }
    const detail = cheerio.load(await fetchPage(url.href));
    if (detail('head > title').text().trim() !== `${title} | 川嶋あい My Room` ||
        detail('#live_detail article h1').text().trim() !== title ||
        detail('#live_detail article p.place span').text().trim() !== prefecture ||
        dateFromNative(detail('#live_detail article p.date').text()) !== date) {
      throw new Error('Ai Kawashima calendar/detail mismatch');
    }
    const bodyDates = detail('#live_detail article .text_area').text().match(/📅\s*(20\d{2})年(\d{1,2})月(\d{1,2})日/g) || [];
    if (bodyDates.length !== 1) throw new Error('Ai Kawashima native performance date missing or ambiguous');
    const bodyMatch = /📅\s*(20\d{2})年(\d{1,2})月(\d{1,2})日/.exec(bodyDates[0]);
    const bodyDate = `${bodyMatch![1]}-${bodyMatch![2].padStart(2, '0')}-${bodyMatch![3].padStart(2, '0')}`;
    if (bodyDate !== date) throw new Error('Ai Kawashima body performance date mismatch');
    const venue = detailVenue(detail);
    const verified = VERIFIED_VENUES.get(venue.name);
    if (!verified || verified.prefecture !== prefecture ||
        (verified.link !== null && venue.link !== verified.link)) {
      throw new Error('Ai Kawashima venue municipality is not verified');
    }
    concerts.push({ artist: ARTIST, date, venue: venue.name, city: verified.city, country: 'JP',
      ticketUrl: url.href, originalSource: config.domain, scrapedAt });
  }
  return concerts;
}
