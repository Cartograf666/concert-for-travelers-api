import type { ScraperConfig } from '../../schemas/config.js';

const TOUR_ID = 'b19bb52c-bf1a-4e6f-beb8-abb33a5ea505';
const TOUR_NAME = 'Sharon Van Etten & The Attachment Theory';
const FEED_URL = `https://cdn.seated.com/api/tour/${TOUR_ID}?include=tour-events`;

type Feed = {
  data?: { id?: unknown; type?: unknown; attributes?: { name?: unknown };
    relationships?: { 'tour-events'?: { data?: unknown } } };
  included?: unknown;
};

export async function scrape(config: ScraperConfig, body: string, _scrapedAt: string): Promise<never[]> {
  if (config.url !== FEED_URL || config.domain !== 'sharonvanetten.com') {
    throw new Error('Sharon Van Etten official Seated source URL changed');
  }
  const feed = JSON.parse(body) as Feed | null;
  const references = feed?.data?.relationships?.['tour-events']?.data;
  if (feed?.data?.id !== TOUR_ID || feed.data.type !== 'tours' ||
      feed.data.attributes?.name !== TOUR_NAME || !Array.isArray(references)) {
    throw new Error('Sharon Van Etten official Seated tour identity or relationship changed');
  }
  if (references.length !== 0) {
    // The official widget belongs to this group, but the legacy source ID has
    // no approved catalog identity for the group. Do not publish its shows as
    // the song/solo catalog entry until that mapping is explicitly resolved.
    throw new Error('Sharon Van Etten Seated tour has events; canonical group identity is pending');
  }
  if (feed.included !== undefined &&
      (!Array.isArray(feed.included) || feed.included.length !== 0)) {
    throw new Error('Sharon Van Etten empty Seated tour has unexpected included events');
  }
  return [];
}
