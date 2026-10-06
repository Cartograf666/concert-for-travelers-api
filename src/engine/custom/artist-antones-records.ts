import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

type Calendar = { error?: unknown; popupdata?: unknown;
  events?: { id?: unknown; start?: unknown; title?: unknown; url?: unknown }[] };

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const calendar: Calendar = JSON.parse(body);
  if (calendar.error !== false || !Array.isArray(calendar.events) || typeof calendar.popupdata !== 'string') {
    throw new Error("Antone's calendar is incomplete or reports an error");
  }
  const $ = cheerio.load(calendar.popupdata);
  const seen = new Set<number>();
  const concerts: Partial<Concert>[] = [];
  for (const event of calendar.events) {
    if (typeof event.id !== 'number' || !Number.isInteger(event.id) || seen.has(event.id) ||
        typeof event.start !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(event.start) ||
        typeof event.title !== 'string' || !event.title.trim() || event.url !== `#tw-event-dialog-${event.id}`) {
      throw new Error("Antone's calendar row has an invalid date or event relationship");
    }
    seen.add(event.id);
    // The venue also sells guided building visits; those are not performances.
    if (/^Guided Full Venue History Tour\b/i.test(event.title)) continue;
    const popup = $(`#tw-event-dialog-${event.id}`);
    const ticketUrl = popup.find('a.tw-buy-tix-btn').attr('href');
    let artist = popup.find('.tw-name a').text().trim();
    // Blue Monday is this venue's weekly blues series, not the homonymous band.
    // The calendar explicitly names its performing attraction separately.
    if (/^Blue Monday\b/i.test(artist)) {
      artist = popup.find('.tw-attractions span').toArray().map(element => $(element).text().trim()).filter(Boolean).join(' & ');
    }
    if (popup.length !== 1 || !artist || !ticketUrl || !/^https?:\/\//.test(ticketUrl)) {
      throw new Error("Antone's calendar event is missing its matching detail or ticket URL");
    }
    concerts.push({ artist, date: event.start, venue: "Antone's Nightclub", city: 'Austin', country: 'US',
      ticketUrl, originalSource: config.domain, scrapedAt });
  }
  return concerts;
}
