import {
  ARTIST_DISCOVERY_BASIS,
  ARTIST_DISCOVERY_VERSION,
  BALANCED_LISTENER_THRESHOLDS,
  type ArtistDiscovery,
  type ArtistDiscoveryAudience
} from '../schemas/artist_discovery.js';

/**
 * Classifies only the stored Last.fm listener count on this exact approved row.
 * Invalid, missing, zero and non-positive values intentionally remain unknown.
 */
export function classifyArtistDiscoveryAudience(listeners: unknown): ArtistDiscoveryAudience {
  if (typeof listeners !== 'number' || !Number.isFinite(listeners) || listeners <= 0) return 'unknown';
  const [veryLarge, large, medium] = BALANCED_LISTENER_THRESHOLDS;
  if (listeners >= veryLarge) return 'very-large';
  if (listeners >= large) return 'large';
  if (listeners >= medium) return 'medium';
  return 'small';
}

/** Pure projection used by both the concert pipeline and the full artist catalog. */
export function artistDiscoveryFor(artist: unknown): ArtistDiscovery {
  const row = typeof artist === 'object' && artist !== null ? artist as { popularity?: { listeners?: unknown } } : undefined;
  return {
    version: ARTIST_DISCOVERY_VERSION,
    audience: classifyArtistDiscoveryAudience(row?.popularity?.listeners),
    basis: ARTIST_DISCOVERY_BASIS,
    metricAsOf: null
  };
}
