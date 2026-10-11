import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

const VENUES: Record<string, { venue: string; city: string; country: string }> = {
  '会場：東京・Zepp DiverCity(TOKYO)': { venue: 'Zepp DiverCity(TOKYO)', city: 'Koto-ku', country: 'JP' },
  'ビルボードライブ東京': { venue: 'Billboard Live Tokyo', city: 'Minato-ku', country: 'JP' },
  'ビルボードライブ大阪': { venue: 'Billboard Live Osaka', city: 'Osaka', country: 'JP' },
  'ビルボードライブ横浜': { venue: 'Billboard Live Yokohama', city: 'Yokohama', country: 'JP' },
  '恵比寿リキッドルーム': { venue: 'LIQUIDROOM', city: 'Shibuya-ku', country: 'JP' }
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<RawConcert[]> {
  const $ = cheerio.load(html);
  if (!/BONNIE PINK/i.test($('title').text())) throw new Error('Bonnie Pink calendar identity missing');
  const concerts: RawConcert[] = [];
  $('.text-list__item').each((_, element) => {
    const row = $(element);
    const printed = row.find('.data-head__date').first().text().trim();
    const match = /^(20\d{2})\.(\d{2})\.(\d{2})$/.exec(printed);
    const date = match ? parseDate(`${match[1]}-${match[2]}-${match[3]}`, scrapedAt) : null;
    if (!date) throw new Error('Bonnie Pink event lacks an explicit full date');
    if (date < scrapedAt.slice(0, 10)) return;
    const body = row.find('.text-list__body').first().clone();
    body.find('br').replaceWith('\n');
    const lines = body.text().normalize('NFKC').split('\n').map(value => value.trim()).filter(Boolean);
    const label = lines.find(line => line.startsWith('会場:') || line.startsWith('会場：') ||
      /ビルボードライブ(?:東京|大阪|横浜)$/.test(line) || line === '恵比寿リキッドルーム');
    const normalized = label?.replace(/^会場:/, '会場：');
    const billboard = normalized?.match(/ビルボードライブ(?:東京|大阪|横浜)$/)?.[0];
    let place = normalized ? VENUES[billboard || normalized] : undefined;
    let startTime: string | undefined;
    // The festival explicitly credits Bonnie Pink's October 11 SORA performance.
    if (normalized === '会場：六呂師高原(福井県大野市南六呂師169字東上谷野)' &&
        date === '2026-10-11' && lines.some(line => /11日.*19時.*SORA STAGE出演/.test(line))) {
      place = { venue: '六呂師高原', city: 'Ono', country: 'JP' };
      startTime = '19:00';
    }
    const href = row.find('.text-list__body a').first().attr('href');
    concerts.push({ artist: 'Bonnie Pink', date, startTime, venue: place?.venue, city: place?.city, country: place?.country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, sourceEventUrl: config.url, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
