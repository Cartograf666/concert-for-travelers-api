import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';
import { safeAbsoluteUrl } from '../url.js';

const URL = 'https://riomarfortaleza.com.br/teatro/paula-fernandes-30-e-poucos-anos-16931';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** ponytail: current-tour venue announcement; not an evergreen artist agenda.
 * Keep failures visible when this announcement disappears; never reuse a frozen itinerary. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const title = clean($('.l-eventos-interna__title').text());
  if (config.url !== URL || config.domain !== 'riomarfortaleza.com.br' ||
      config.selectors?.artistNameFallback !== 'Paula Fernandes' ||
      $('link[rel="canonical"]').attr('href') !== URL || title !== 'Paula Fernandes - 30 e Poucos Anos') {
    throw new Error('Paula venue announcement identity missing');
  }
  const content = $('.l-eventos-interna__feature__text');
  if (content.length !== 1 || !content.text().includes('Opus Entretenimento')) throw new Error('Paula promoter announcement missing');
  if (/\b(cancelad[oa]s?|adiad[oa]s?|cancelled|postponed)\b/i.test(content.text())) {
    throw new Error('Paula cancellation or postponement requires itinerary revalidation');
  }
  const heading = content.find('p').filter((_, node) => /^As primeiras datas confirmadas da turnê/.test(clean($(node).text())));
  if (heading.length !== 1) throw new Error('Paula confirmed tour dates heading missing');
  const schedule = heading.next('p').clone();
  schedule.find('br').replaceWith('\n');
  const lines = schedule.text().split('\n').map(clean).filter(Boolean);
  if (!lines.length) throw new Error('Paula tour dates empty');
  const ticketUrl = safeAbsoluteUrl($('a[href*="uhuu.com/evento/"]').first().attr('href') ?? '', URL);
  const rows: Partial<Concert>[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const match = /^(\d{1,2}) de ([a-zç]+) de (20\d{2}) [–—-] (.+)\/([A-Z]{2}) [–—-] (.+)$/.exec(line);
    if (!match) throw new Error(`Paula malformed tour date: ${line}`);
    const month = MONTHS.indexOf(match[2]) + 1;
    const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    if (!month || !STATES.has(match[5]) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new Error(`Paula unsupported date or Brazilian state: ${line}`);
    }
    const localEvent = match[4] === 'Fortaleza' && match[6] === 'Teatro RioMar Fortaleza';
    const key = `${date}|${match[4]}|${match[6]}`;
    if (seen.has(key)) throw new Error('Paula duplicate itinerary row');
    seen.add(key);
    if (localEvent && (!ticketUrl || new globalThis.URL(ticketUrl).hostname !== 'uhuu.com' ||
        clean($('.text-date').text()) !== `Dia ${match[1].padStart(2, '0')}/${String(month).padStart(2, '0')}`)) {
      throw new Error('Paula dedicated venue date or ticket link disagrees');
    }
    rows.push({ artist: 'Paula Fernandes', date, city: match[4], venue: match[6], country: 'BR',
      // The venue supplies one sale link; it must not leak onto other tour stops.
      ...(localEvent ? { ticketUrl, eventUrl: URL } : {}), originalSource: config.domain, scrapedAt });
  }
  return rows;
}
