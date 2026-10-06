import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  if (!$('title').text().includes('妖精帝國') || !$('.iron_widget_events').length) {
    throw new Error('Yōsei Teikoku official live calendar changed');
  }
  return $('.iron_widget_events').first().find('li.event').toArray().map(element => {
    const row = $(element);
    const cells = row.find('.event-line-node').toArray().map(node => $(node).text().trim());
    const dateParts = /^(20\d{2})年(\d{1,2})月(\d{1,2})日$/.exec(cells[0] ?? '');
    const place = /^([^,]+),\s*(.+)$/.exec(cells[1] ?? '');
    const ticketUrl = row.find('a.event-link').attr('href');
    if (!dateParts || !place || !ticketUrl || !cells[2]) throw new Error('Yōsei Teikoku official event row is incomplete');
    return {
      artist: 'Yōsei Teikoku', date: `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}`,
      city: place[1], venue: place[2], country: 'JP', ticketUrl, originalSource: config.domain, scrapedAt
    };
  });
}
