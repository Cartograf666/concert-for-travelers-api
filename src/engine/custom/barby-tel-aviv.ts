import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

type BarbyShow = {showId?: unknown; showDate?: unknown; showName?: unknown};
type BarbyFeed = {returnShow?: {show?: BarbyShow[]}};

export async function scrape(config: ScraperConfig, body: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const feed: BarbyFeed = JSON.parse(body);
  const shows = feed.returnShow?.show;
  if (!Array.isArray(shows)) throw new Error('Barby official show feed structure changed');
  return shows.flatMap(show => {
    const id = show.showId;
    const name = typeof show.showName === 'string' ? show.showName.trim() : '';
    if (id === '3298' && name === 'מייל שירות הלקוחות') return []; // Site's dated customer-service contact card.
    const match = typeof show.showDate === 'string' && /^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(show.showDate);
    if (typeof id !== 'string' || !/^\d+$/.test(id) || !name || !match) {
      throw new Error('Barby show lacks explicit identity, full date or headline');
    }
    const [, day, month, year] = match;
    const date = `${year}-${month}-${day}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`Barby show has invalid calendar date: ${show.showDate}`);
    }
    if (date < scrapedAt.slice(0, 10)) return [];
    return [{
      artist: name, date, venue: 'Barby', city: 'Tel Aviv', country: 'IL',
      ticketUrl: 'https://barby.co.il/', originalSource: config.domain, scrapedAt
    }];
  });
}
