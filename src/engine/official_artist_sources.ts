import type { Concert } from '../schemas/concert.js';
import type { ScrapeCache } from './cache.js';
import { loadConfigs, scraperCacheFingerprint } from './runner.js';

export interface OfficialArtistSource {
  readonly configId: string;
  readonly artist: string;
  readonly url: string;
  readonly domain: string;
}

export type OfficialArtistContext = WeakMap<Partial<Concert>, { artist: string }>;

export const OFFICIAL_ARTIST_SOURCES: readonly OfficialArtistSource[] = [
  { configId: 'artist-hue-cry', artist: 'Hue & Cry', url: 'https://hueandcry.co.uk/live/', domain: 'hueandcry.co.uk' },
  { configId: 'artist-steve-cardenas', artist: 'Steve Cardenas', url: 'http://stevecardenasmusic.com/schedule/', domain: 'stevecardenasmusic.com' },
  { configId: 'artist-ocean-colour-scene', artist: 'Ocean Colour Scene', url: 'https://www.oceancolourscene.com/tour', domain: 'www.oceancolourscene.com' },
  { configId: 'artist-puts-kevin', artist: 'Puts, Kevin', url: 'https://www.kevinputs.com/events', domain: 'www.kevinputs.com' },
  { configId: 'artist-andrea-motis', artist: 'Andrea Motis', url: 'https://andreamotis.com/agenda/', domain: 'andreamotis.com' }
];

/** Trust belongs to row identity in the active, verified cache, never to fields copied onto raw rows. */
export async function buildOfficialArtistContext(
  activeCache: ScrapeCache,
  configsDir: string,
  nowMs = Date.now(),
  registry: readonly OfficialArtistSource[] = OFFICIAL_ARTIST_SOURCES
): Promise<OfficialArtistContext> {
  const context: OfficialArtistContext = new WeakMap();
  if (!Number.isFinite(nowMs)) return context;

  // loadConfigs validates the full schema and takes config.id from contents, so
  // a renamed file still works and malformed configs cannot grant authority.
  const configs = await loadConfigs(configsDir);
  const configsById = new Map(configs.map(config => [config.id, config]));
  for (const source of registry) {
    const config = configsById.get(source.configId);
    const entry = activeCache[source.configId];
    if (!config || !entry || !Array.isArray(entry.concerts) ||
        config.url !== source.url || config.domain !== source.domain) continue;

    const verifiedAt = typeof entry.verifiedAt === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(entry.verifiedAt)
      ? Date.parse(entry.verifiedAt) : Number.NaN;
    if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs) continue;
    try {
      if (entry.cacheFingerprint !== await scraperCacheFingerprint(config)) continue;
    } catch {
      // A missing or unreadable current implementation cannot prove the cache's
      // provenance. The rows still enter normal processing as fallback.
      continue;
    }
    for (const row of entry.concerts) {
      if (row && typeof row === 'object' && row.originalSource === source.domain && row.artist === source.artist) {
        context.set(row, { artist: source.artist });
      }
    }
  }
  return context;
}
