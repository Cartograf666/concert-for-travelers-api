import { z } from 'zod';

/**
 * A deliberately stable, offline classification of the Last.fm listener count
 * stored on the approved artist row. It is not a claim about current/global
 * popularity, and carries no confidence, trend, era, or generation inference.
 */
export const ARTIST_DISCOVERY_VERSION = 1 as const;
export const ARTIST_DISCOVERY_BASIS = 'lastfm-listeners' as const;
export const BALANCED_LISTENER_THRESHOLDS = [1_000_000, 100_000, 10_000] as const;

export const ARTIST_DISCOVERY_AUDIENCES = ['very-large', 'large', 'medium', 'small', 'unknown'] as const;
export type ArtistDiscoveryAudience = typeof ARTIST_DISCOVERY_AUDIENCES[number];

export const ArtistDiscoverySchema = z.object({
  version: z.literal(ARTIST_DISCOVERY_VERSION),
  audience: z.enum(ARTIST_DISCOVERY_AUDIENCES),
  basis: z.literal(ARTIST_DISCOVERY_BASIS),
  metricAsOf: z.null()
});

export type ArtistDiscovery = z.infer<typeof ArtistDiscoverySchema>;
