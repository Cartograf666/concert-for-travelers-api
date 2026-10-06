import * as cheerio from 'cheerio';
import type { ScraperConfig } from '../../schemas/config.js';
import type { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  let year: string | undefined;
  $('.post_content').first().children().each((_, element) => {
    const node = $(element);
    if (node.is('h4')) {
      year = node.text().match(/\b20\d{2}\b/)?.[0];
      return;
    }
    if (!year) return;
    // Paragraphs within a concert section can be nested in plain divs.
    const paragraphs = node.is('p') ? node : node.find('p');
    paragraphs.each((_, paragraph) => {
      const text = $(paragraph).text().replace(/\s+/g, ' ').trim();
      const match = text.match(/(?:^|\s)(\d{1,2})月(\d{1,2})日\([^)]*\)\s*([^：:]+?)[：:]\s*(.+)$/);
      if (!match) return;
      const month = Number(match[1]);
      const day = Number(match[2]);
      const city = match[3].trim();
      const venue = match[4].split(/\s+(?:open|start|thank|※)/i)[0].trim();
      if (month < 1 || month > 12 || day < 1 || day > 31 || !city || !venue) return;
      concerts.push({
        artist: 'Mimori Yusa', date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        venue, city, country: 'JP', ticketUrl: config.url, originalSource: config.domain, scrapedAt
      });
    });
  });
  return concerts;
}
