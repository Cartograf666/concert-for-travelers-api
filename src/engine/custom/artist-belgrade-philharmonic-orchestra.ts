import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

const SEASON_URL = 'https://www.bgf.rs/en/kategorije-repertoar/concert-season-26-27/';
const VENUE = 'Grand Hall of the Kolarac Foundation';
const ARTIST = 'Belgrade Philharmonic Orchestra';

function localDate(scrapedAt: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(scrapedAt)) return;
  const instant = new Date(scrapedAt);
  if (!Number.isFinite(instant.getTime())) return;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(instant);
}

function calendarDate(raw: string): string | undefined {
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})\.$/);
  if (!match) return;
  const date = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

/** Only the verified English season archive can establish these orchestra performances. */
export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const today = localDate(scrapedAt);
  if (!today || config.url !== SEASON_URL || config.domain !== 'www.bgf.rs') return [];

  const $ = cheerio.load(html);
  if ($('body.term-concert-season-26-27').length !== 1 ||
      $('link[rel="canonical"]').length !== 1 ||
      $('link[rel="canonical"]').attr('href') !== SEASON_URL) return [];

  const byDate = new Map<string, { concert: Partial<Concert>; title: string; programmeUrl: string }>();
  const conflicts = new Set<string>();
  $('#cd-timeline article.timeline-post').each((_, element) => {
    const card = $(element);
    const block = card.closest('.cd-timeline-block');
    const status = block.length ? block : card;
    if (/(?:cancelled|canceled|postponed)/i.test(status.text()) ||
        /(?:cancelled|canceled|postponed)/i.test(`${card.attr('class') || ''} ${block.attr('class') || ''}`)) return;
    const dateFields = card.find('.repertoire-date');
    const timeFields = card.find('.repertoire-time');
    const placeFields = card.find('.repertoire-place');
    const programmeLinks = card.find('.other-info h4 a');
    if (dateFields.length !== 1 || timeFields.length !== 1 || placeFields.length !== 1 || programmeLinks.length !== 1) return;
    const date = calendarDate(dateFields.text().trim());
    const startTime = timeFields.text().trim();
    const venue = placeFields.text().replace(/\s+/g, ' ').trim();
    const title = programmeLinks.text().replace(/\s+/g, ' ').trim();
    const href = programmeLinks.attr('href');
    if (!date || date < today || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
        venue !== VENUE || !title || !href) return;
    let programmeUrl: URL;
    try { programmeUrl = new URL(href); } catch { return; }
    if (programmeUrl.protocol !== 'https:' || programmeUrl.hostname !== 'www.bgf.rs' ||
        programmeUrl.username || programmeUrl.password || programmeUrl.port ||
        !/^\/en\/repertoar_cp\/[^/]+\/$/.test(programmeUrl.pathname)) return;

    // The observed cards have programme links, not direct ticket links.
    const concert: Partial<Concert> = {
      artist: ARTIST, date, startTime, venue: VENUE, city: 'Belgrade', country: 'RS',
      originalSource: config.domain, scrapedAt
    };
    const previous = byDate.get(date);
    if (previous && (previous.concert.startTime !== startTime || previous.concert.venue !== venue ||
        // Distinct programmes on one date cannot safely be represented as one row.
        previous.title !== title || previous.programmeUrl !== programmeUrl.href)) {
      conflicts.add(date);
    } else if (!previous) {
      byDate.set(date, { concert, title, programmeUrl: programmeUrl.href });
    }
  });
  return [...byDate].filter(([date]) => !conflicts.has(date)).map(([, row]) => row.concert);
}
