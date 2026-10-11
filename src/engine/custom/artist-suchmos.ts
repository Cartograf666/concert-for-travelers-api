import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

// Exact venue labels and official address proofs live in the dedicated fixture proof.
const VENUES: Record<string, { venue: string; city: string; country: string }> = {
  'ゼビオアリーナ仙台 (宮城県)': { venue: 'Xebio Arena Sendai', city: 'Sendai', country: 'JP' },
  'マリンメッセ福岡B館 (福岡県)': { venue: 'Marine Messe Fukuoka B', city: 'Fukuoka', country: 'JP' },
  'Kアリーナ横浜 (神奈川県)': { venue: 'K-Arena Yokohama', city: 'Yokohama', country: 'JP' },
  'GLION ARENA KOBE (兵庫県)': { venue: 'GLION ARENA KOBE', city: 'Kobe', country: 'JP' }
};

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('Suchmos')) throw new Error('Suchmos calendar identity missing');
  const concerts: Partial<Concert>[] = [];
  $('.news-item.loop').each((_, element) => {
    const row = $(element);
    const match = /^出演日:\s*(20\d{2})\.(\d{1,2})\.(\d{1,2})$/.exec(row.find('date').first().text().trim());
    const date = match ? parseDate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, scrapedAt) : null;
    if (!date) throw new Error('Suchmos event lacks an explicit performance date');
    if (date < scrapedAt.slice(0, 10)) return;
    const body = row.find('.text').first().text().replace(/\s+/g, ' ').trim();
    const label = /会場[：:]\s*(.*?)\s*時間[：:]/.exec(body)?.[1];
    const place = label ? VENUES[label] : undefined;
    const href = row.find('.text a').first().attr('href');
    concerts.push({ artist: 'Suchmos', date, venue: place?.venue, city: place?.city, country: place?.country,
      ticketUrl: href ? safeAbsoluteUrl(href, config.url) : undefined, originalSource: config.domain, scrapedAt });
  });
  return concerts;
}
