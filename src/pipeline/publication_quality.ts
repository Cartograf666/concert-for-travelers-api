import type { Concert } from '../schemas/concert.js';

/** A product planning window, not proof that later shows are false. Such rows
 * remain in raw evidence and can be reconsidered by changing this setting. */
export const DEFAULT_MAX_FUTURE_DAYS = 730;
const DAY_MS = 86_400_000;
export interface PublicationQualityOptions { maxFutureDays?: number }
export type PublicationQualityDropReason = 'badDate' | 'beyondPlanningHorizon';

export function publicationMaxFutureDays(value: unknown = process.env.CONCERT_MAX_FUTURE_DAYS): number {
  if (value === undefined) return DEFAULT_MAX_FUTURE_DAYS;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || (typeof value === 'string' && !/^\d+$/.test(value))) {
    throw new Error('CONCERT_MAX_FUTURE_DAYS / maxFutureDays must be a positive integer');
  }
  return days;
}

/** Pure predicate for deterministic offline replay. Validates actual calendar
 * days (the public schema's YYYY-MM-DD regex alone admits February 30). */
export function publicationQualityDropReason(date: string, baseDate: string, maxFutureDays: number): PublicationQualityDropReason | undefined {
  const day = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return 'badDate';
  const base = Date.parse(`${baseDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(base)) throw new Error('Publication baseDate must be a valid ISO date');
  if (day - base > maxFutureDays * DAY_MS) return 'beyondPlanningHorizon';
}

/** Only safe links supplied by the source; never infer a ticket/event link from
 * artistWebsite. Unsafe optional links do not discard an otherwise valid show. */
export function sourceActionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return trimmed;
  } catch { return; }
}

/** Batch keys avoid order-dependent sparse-row merging. Different countries,
 * named venues and known showtimes survive. A missing venue/time can attach only
 * to one unambiguous completion; two known shows never collapse via a sparse row.
 * Source-proven location equivalences are applied before temporal/URL grouping. */
export function occurrenceVenueKeys(concerts: Concert[]): string[] {
  const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const cityKey = (c: Concert) => JSON.stringify([norm(c.artist), c.date, c.country, norm(c.city)]);
  const venues = new Map<string, Set<string>>();
  for (const c of concerts) {
    const key = cityKey(c);
    if (!venues.has(key)) venues.set(key, new Set());
    if (norm(c.venue) !== 'unknown venue') venues.get(key)!.add(norm(c.venue));
  }
  const venueKey = (c: Concert) => {
    const known = venues.get(cityKey(c))!;
    const venue = norm(c.venue) === 'unknown venue' && known.size === 1 ? [...known][0] : norm(c.venue);
    return JSON.stringify([cityKey(c), venue]);
  };
  return concerts.map(venueKey);
}

/** A finite location proof cannot overrule known showtimes or distinct explicit
 * event pages from the same source. Different providers naturally use different
 * URLs for one event, so URL inequality across providers is not a split rule.
 * Ambiguous unlinked rows keep their own source bucket instead of joining either
 * explicit event; keys are calculated from the full batch, never input order. */
export function occurrenceDedupeKeys(concerts: Concert[], locationKeys = occurrenceVenueKeys(concerts)): string[] {
  const times = new Map<string, Set<string>>();
  concerts.forEach((c, i) => {
    const key = locationKeys[i];
    if (!times.has(key)) times.set(key, new Set());
    if (c.startTime) times.get(key)!.add(c.startTime);
  });
  const timedKeys = concerts.map((c, i) => {
    const key = locationKeys[i], known = times.get(key)!;
    return JSON.stringify([key, c.startTime ?? (known.size === 1 ? [...known][0] : '')]);
  });
  const source = (c: Concert) => c.originalSource.trim().toLowerCase();
  const identity = (c: Concert) => {
    const safe = sourceActionUrl(c.eventUrl);
    return safe ? new URL(safe).href : undefined;
  };
  const urlsBySource = new Map<string, Map<string, Set<string>>>();
  const urls = concerts.map(identity);
  concerts.forEach((c, i) => {
    const key = timedKeys[i];
    if (!urlsBySource.has(key)) urlsBySource.set(key, new Map());
    const sources = urlsBySource.get(key)!;
    if (!sources.has(source(c))) sources.set(source(c), new Set());
    if (urls[i]) sources.get(source(c))!.add(urls[i]!);
  });
  return concerts.map((c, i) => {
    const key = timedKeys[i];
    const sources = urlsBySource.get(key)!;
    if (![...sources.values()].some(urls => urls.size > 1)) return key;
    // Never attach a sparse row or a differently linked provider to an
    // arbitrary one of the same source's explicit event pages.
    return JSON.stringify([key, source(c), urls[i] ?? '']);
  });
}
