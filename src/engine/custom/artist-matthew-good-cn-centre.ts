import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { parseDate } from '../../pipeline/process.js';
import { safeAbsoluteUrl } from '../url.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const main = $('main');
  const title = main.find('h1.page-title').text().trim();
  if (!/^Matthew Good and His Band with I Mother Earth$/i.test(title)) return [];
  const body = main.find('.field--name-body');
  if (/cancelled|canceled|postponed/i.test(title + body.text())) return [];
  const native = main.find('.views-field-field-when time[datetime]').first().attr('datetime') || '';
  const date = native.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(native) || parseDate(date, scrapedAt) !== date || !/\bCN Centre\b/.test(body.text())) return [];
  const ticket = body.find('a[href]').filter((_, el) => /ticketsnorth\.ca/.test($(el).attr('href') || '')).first().attr('href');
  // This is a city-owned CN Centre event page; its venue/city are fixed scope,
  // not fallback geography for unrelated entries in the city's event calendar.
  return [{ artist: 'Matthew Good', date, venue: 'CN Centre', city: 'Prince George', country: 'CA',
    eventUrl: config.url, ticketUrl: ticket ? safeAbsoluteUrl(ticket, config.url) : undefined,
    originalSource: config.domain, scrapedAt }];
}
