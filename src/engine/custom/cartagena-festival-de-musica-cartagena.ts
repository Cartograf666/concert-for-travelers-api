import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { RawConcert } from '../../schemas/concert.js';
import { fetchHtmlForHealing } from '../runner.js';

const ORIGIN = 'https://cartagenamusicfestival.com';
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function nativeUrl(raw: string | undefined, kind: string): string {
  if (!raw) throw new Error(`Cartagena missing ${kind} URL`);
  const url = new URL(raw, ORIGIN);
  if (url.origin !== ORIGIN || url.username || url.password || url.hash ||
      !((new RegExp(`^/${kind}/[^/]+/$`).test(url.pathname) &&
          (url.search === '' || url.search === '?lang=en')) ||
        (kind === 'artistas' && url.pathname === '/' && /^\?post_type=role-member&p=\d+$/.test(url.search)))) {
    throw new Error(`Cartagena unsafe native ${kind} URL`);
  }
  return url.href;
}

function startTime(raw: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])\.\s*m\.?$/i.exec(clean(raw));
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) {
    throw new Error('Cartagena invalid native time');
  }
  return `${String(+match[1] % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0)).padStart(2, '0')}:${match[2]}`;
}

function roleLinks($: cheerio.CheerioAPI, name: string): { name: string; url: string }[] {
  const roles = $('.mkdf-shows-single-holder .mkdf-show-role').filter((_, el) =>
    clean($(el).find('.mkdf-show-role-title').text()) === name);
  if (roles.length !== 1) throw new Error(`Cartagena missing or ambiguous ${name} section`);
  const links = roles.find('ul li h5 a').toArray().map(el => ({
    name: clean($(el).text()), url: nativeUrl($(el).attr('href'), 'artistas')
  }));
  if (!links.length || links.some(link => !link.name)) throw new Error(`Cartagena missing ${name} names`);
  return links;
}

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string,
  fetchPage: (url: string) => Promise<string> = url => fetchHtmlForHealing(url, 'axios')): Promise<RawConcert[]> {
  if (config.url !== `${ORIGIN}/programacion/?lang=en` || config.domain !== 'cartagenamusicfestival.com') {
    throw new Error('Cartagena official source identity mismatch');
  }
  const $ = cheerio.load(html);
  const programmeYear = /Programación Cartagena Festival de Música (20\d{2})/.exec($('head > title').text())?.[1];
  if (!programmeYear) {
    throw new Error('Cartagena native programme identity missing');
  }
  // The official programme explicitly locates its January festival in Cartagena.
  // The launch card separately labels Bogotá; never inherit the festival city there.
  if (!/en Cartagena de Indias/.test($('meta[name=description]').attr('content') || '')) {
    throw new Error('Cartagena native festival location missing');
  }
  const cards = $('.mkdf-event-list-item').toArray().map(el => {
    const card = $(el);
    const title = clean(card.find('.mkdf-eli-title').text());
    const subtitle = clean(card.find('.mkdf-eli-subtitle').text()).split(/\s*\|\s*/);
    const day = clean(card.find('.mkdf-el-date-separated h1').text());
    const month = clean(card.find('.mkdf-el-date-separated h6').text());
    if (!title || subtitle.length !== 2 || !subtitle[1] || !/^\d{1,2}$/.test(day) || !EN_MONTHS.includes(month)) {
      throw new Error('Cartagena incomplete native programme card');
    }
    // The January programme is explicitly in Cartagena; only the separately
    // labelled Bogotá launch is outside that festival location.
    if ((month !== 'January' && !subtitle[1].endsWith('(Bogotá)')) ||
        /\([^)]*\)/.test(subtitle[1]) && !/\((?:Bogotá|PRIVADO|Transmisión)\)$/.test(subtitle[1])) {
      throw new Error('Cartagena unverified native event location');
    }
    return { title, day: +day, month: EN_MONTHS.indexOf(month), time: startTime(subtitle[0]),
      city: subtitle[1].endsWith('(Bogotá)') ? 'Bogotá' : 'Cartagena',
      url: nativeUrl(card.find('.mkdf-eli-read-more-holder a.mkdf-btn-outline').attr('href'), 'show-item'),
      ticketUrl: nativeUrl(card.find('.mkdf-eli-read-more-holder a.mkdf-btn-solid').attr('href'), 'tc-events') };
  });
  if (!cards.length) throw new Error('Cartagena native programme cards missing');
  if (new Set(cards.map(card => card.url)).size !== cards.length) throw new Error('Cartagena duplicate programme detail URL');

  // Two requests at most, with a gap between batches. Stop scheduling before the
  // collector's existing 90s ceiling; a partial source must never report success.
  const deadline = Date.now() + 70000;
  const concerts: RawConcert[] = [];
  for (let index = 0; index < cards.length; index += 2) {
    if (index) await new Promise(resolve => setTimeout(resolve, 250));
    if (Date.now() > deadline - 15000) throw new Error('Cartagena complete programme exceeds detail fetch budget');
    const batch = await Promise.all(cards.slice(index, index + 2).map(async card => {
      const detail = cheerio.load(await fetchPage(card.url));
      if (detail('link[rel=canonical]').attr('href') !== card.url || !clean(detail('.mkdf-page-title.entry-title').text())) {
        throw new Error(`Cartagena native detail identity missing: ${card.url}`);
      }
      const heading = clean(detail('.mkdf-single-show-description > h6').first().text());
      const dateMatch = /^[^ ]+ (\d{1,2}) de ([a-z]+) de (20\d{2})\s*-\s*(.+)$/i.exec(heading);
      if (!dateMatch) throw new Error(`Cartagena missing full native date: ${card.url}`);
      const month = MONTHS.indexOf(dateMatch[2].toLowerCase());
      const expectedYear = card.city === 'Bogotá' ? Number(programmeYear) - 1 : Number(programmeYear);
      const date = `${dateMatch[3]}-${String(month + 1).padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (month < 0 || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date ||
          +dateMatch[3] !== expectedYear || +dateMatch[1] !== card.day || month !== card.month || startTime(dateMatch[4]) !== card.time) {
        throw new Error(`Cartagena inconsistent native date/time: ${card.url}`);
      }
      const venues = roleLinks(detail, 'ESCENARIO');
      if (venues.length !== 1) throw new Error(`Cartagena ambiguous native venue: ${card.url}`);
      const artists = roleLinks(detail, 'ARTISTAS');
      const description = clean(detail('.mkdf-single-show-description').text());
      // Ambiguous listing CSS categories also label live concerts; only explicit
      // native detail conference descriptions and broadcasts are excluded.
      // 'Abre su ciclo' alone leaves the opening Bietti session ambiguous;
      // keep its native row and let source-scoped artist approval quarantine it.
      if (/ciclo de conferencias|tema de la conferencia/i.test(description) ||
          /^Transmisión:/.test(card.title)) return [];
      return artists.map(artist => ({ artist: artist.name, date, startTime: card.time,
        venue: venues[0].name, city: card.city, country: 'CO', ticketUrl: card.ticketUrl,
        sourceEventUrl: card.url, originalSource: config.domain, scrapedAt,
        festival: { name: 'Cartagena Festival de Música', url: config.url },
        lineup: artists.filter(other => other.name !== artist.name).map(other => other.name) }));
    }));
    concerts.push(...batch.flat());
  }
  return concerts;
}
