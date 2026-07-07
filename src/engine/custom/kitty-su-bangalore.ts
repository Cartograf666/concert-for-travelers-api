import * as cheerio from 'cheerio';
import { ScraperConfig } from '../../schemas/config.js';
import { Concert } from '../../schemas/concert.js';

export async function scrape(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];

  // Extract event list items from Kitty Su's events page
  // Format: <li><div class="event-list-img">...</div><div class="event-list-text">
  //   <h3>Show Girls | Bangalore</h3>
  //   <p>Bangalore | India | 12 July - 13 July | 08:30 PM</p>
  // </div></li>

  $('ul.event-list > li').each((_, el) => {
    try {
      const block = $(el);

      // Extract artist/event title from h3
      const h3Text = block.find('.event-list-text h3').text().trim();
      if (!h3Text) return;

      // Parse format: "Event Name | City"
      const [eventName, city] = h3Text.split('|').map(s => s.trim());
      if (!eventName) return;

      // Only process Bangalore events
      if (city && city.toLowerCase() !== 'bangalore') {
        return;
      }

      // Extract date and time info from paragraph
      const pText = block.find('.event-list-text p').text().trim();
      if (!pText) return;

      // Parse format: "Bangalore | India | 12 July - 13 July | 08:30 PM"
      // We want to extract the date part
      const parts = pText.split('|').map(s => s.trim());

      let dateStr = '';
      let year = new Date().getFullYear().toString();

      if (parts.length >= 3) {
        // The date is typically in parts[2]
        const datePart = parts[2];
        // Format: "12 July - 13 July" or similar
        // We take the start date
        if (datePart) {
          const dateMatch = datePart.match(/(\d{1,2})\s+(\w+)/);
          if (dateMatch) {
            dateStr = `${dateMatch[1]} ${dateMatch[2]} ${year}`;
          }
        }
      }

      if (!dateStr) return;

      // Extract ticket URL from the link
      const ticketUrl = block.find('.event-list-img a').attr('href');
      const fullTicketUrl = ticketUrl ? `https://www.kittysu.com${ticketUrl}` : undefined;

      concerts.push({
        artist: eventName,
        date: dateStr,
        venue: config.selectors?.venueNameFallback,
        city: config.selectors?.cityNameFallback,
        country: config.selectors?.countryNameFallback,
        lat: config.selectors?.lat,
        lng: config.selectors?.lng,
        ticketUrl: fullTicketUrl,
        originalSource: config.domain,
        scrapedAt
      });
    } catch (e) {
      // Skip this event if parsing fails
    }
  });

  return concerts;
}
