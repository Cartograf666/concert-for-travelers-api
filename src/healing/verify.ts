/**
 * The real acceptance gate for a repaired scraper config.
 *
 * What this replaces: self-heal.yml's "Verify Fixed Configs" step ran `npm run
 * test` -- the whole repo unit suite, which passes identically whether the new
 * selectors are correct or point at the site's cookie banner. The only actual
 * check was inside repairScraperConfig: "the new selectors extract >=1 event
 * from the cached HTML sample". That accepts, and auto-merges, selectors that
 * yield 40 rows of artist="Read more" / date="" against a week-old snapshot.
 *
 * This module instead runs the candidate config against the LIVE page through
 * the normal runScraper path and asserts the extracted events are plausible
 * concert data. A repair that cannot clear these checks never reaches the PR.
 */

import { ScraperConfig } from '../schemas/config.js';
import { Concert } from '../schemas/concert.js';
import { parseDate } from '../pipeline/process.js';

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  eventCount: number;
  checks: VerifyCheck[];
  /**
   * Why the live probe failed, when it did. `selectors_stale` here is a useful
   * signal rather than a dead end: it means the candidate URL was fetched fine
   * and only the parsing failed, which is what a moved page looks like once the
   * site has also been redesigned.
   */
  failureReason?: string;
  /** Markup from the live probe, so a caller can chain into selector repair. */
  htmlSample?: string;
}

export interface VerifyOptions {
  /**
   * Events this scraper produced on its last good run. A repair that extracts a
   * small fraction of that is extracting something else (nav links, related-events
   * teasers) and must be rejected even though it technically "found events".
   * Omit when there is no baseline (a scraper that never worked).
   */
  baselineCount?: number;
  /** Anchor for relative date parsing ("this Friday"). Defaults to now. */
  now?: Date;
}

/**
 * Text that shows up when a selector grabs chrome instead of an artist name.
 * Compared case-insensitively against the whole trimmed value, not a substring
 * match -- "The Tickets" is a real band name, a cell reading exactly "tickets"
 * is a button.
 */
export const JUNK_ARTIST_VALUES = new Set([
  'tickets', 'ticket', 'buy tickets', 'get tickets', 'book now', 'book tickets',
  'read more', 'more info', 'more information', 'details', 'view details',
  'learn more', 'see more', 'info', 'rsvp', 'sold out', 'free', 'event',
  'events', 'concert', 'concerts', 'show', 'shows', 'tour', 'tour dates',
  'upcoming', 'upcoming events', 'calendar', 'schedule', 'tba', 'tbd',
  'n/a', 'na', 'none', 'null', 'undefined', 'more', 'here', 'click here'
]);

const MIN_ARTIST_LEN = 2;
const MAX_ARTIST_LEN = 120;

/** Fraction of events whose date string must parse for the repair to be believable. */
const MIN_DATE_PARSE_RATE = 0.6;
/** Fraction of artist values allowed to look like page chrome. */
const MAX_JUNK_ARTIST_RATE = 0.2;
/** Fraction of present ticketUrls that must be absolute http(s). */
const MIN_ABSOLUTE_URL_RATE = 0.8;
/** How far the event count may fall below the last good run before it reads as a mis-selection. */
const MIN_BASELINE_RETENTION = 0.3;

function isJunkArtist(value: string | undefined, config: ScraperConfig): boolean {
  const v = (value ?? '').trim();
  if (v.length < MIN_ARTIST_LEN || v.length > MAX_ARTIST_LEN) return true;
  if (JUNK_ARTIST_VALUES.has(v.toLowerCase())) return true;
  // A selector that accidentally targets the venue heading yields the venue name
  // in every row -- valid-looking text, useless data.
  const venue = config.selectors?.venueNameFallback?.trim();
  if (venue && venue.length > 0 && v.toLowerCase() === venue.toLowerCase()) return true;
  // Pure punctuation/digits is never an artist ("12", "--", "•").
  if (!/[\p{L}]/u.test(v)) return true;
  return false;
}

/**
 * Pure plausibility checks over already-extracted events. Separated from the
 * network call so the invariants are unit-testable without a live site.
 */
export function verifyEvents(
  events: Partial<Concert>[],
  config: ScraperConfig,
  options: VerifyOptions = {}
): VerifyReport {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const checks: VerifyCheck[] = [];

  checks.push({
    name: 'has_events',
    ok: events.length > 0,
    detail: `${events.length} event(s) extracted`
  });

  if (events.length === 0) {
    return { ok: false, eventCount: 0, checks };
  }

  const parsed = events.map((e) => (e.date ? parseDate(String(e.date), nowIso) : null));
  const parsedCount = parsed.filter(Boolean).length;
  const parseRate = parsedCount / events.length;
  checks.push({
    name: 'dates_parse',
    ok: parseRate >= MIN_DATE_PARSE_RATE,
    detail: `${parsedCount}/${events.length} date strings parsed (${(parseRate * 100).toFixed(0)}%, need ${MIN_DATE_PARSE_RATE * 100}%)`
  });

  // A schedule page that only yields past dates means the selector latched onto an
  // archive block, or the site stopped updating -- either way not a working repair.
  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
  const futureCount = parsed.filter((d) => d !== null && new Date(d).getTime() >= cutoffMs).length;
  checks.push({
    name: 'has_future_dates',
    ok: futureCount > 0,
    detail: `${futureCount} event(s) dated today or later`
  });

  const junkCount = events.filter((e) => isJunkArtist(e.artist, config)).length;
  const junkRate = junkCount / events.length;
  checks.push({
    name: 'artist_names_plausible',
    ok: junkRate <= MAX_JUNK_ARTIST_RATE,
    detail: `${junkCount}/${events.length} artist values look like page chrome (${(junkRate * 100).toFixed(0)}%, allow ${MAX_JUNK_ARTIST_RATE * 100}%)`
  });

  const withUrl = events.filter((e) => typeof e.ticketUrl === 'string' && e.ticketUrl.length > 0);
  if (withUrl.length > 0) {
    const absolute = withUrl.filter((e) => /^https?:\/\//i.test(String(e.ticketUrl))).length;
    const rate = absolute / withUrl.length;
    checks.push({
      name: 'ticket_urls_absolute',
      ok: rate >= MIN_ABSOLUTE_URL_RATE,
      detail: `${absolute}/${withUrl.length} ticket URLs are absolute http(s) (${(rate * 100).toFixed(0)}%)`
    });
  }

  if (typeof options.baselineCount === 'number' && options.baselineCount > 0) {
    const floor = Math.max(1, Math.floor(options.baselineCount * MIN_BASELINE_RETENTION));
    checks.push({
      name: 'no_volume_collapse',
      ok: events.length >= floor,
      detail: `${events.length} event(s) vs ${options.baselineCount} on the last good run (need >= ${floor})`
    });
  }

  return {
    ok: checks.every((c) => c.ok),
    eventCount: events.length,
    checks
  };
}

/** Injectable so tests can drive the gate without network access. */
export type RunScraperFn = (config: ScraperConfig) => Promise<{
  success: boolean;
  concerts: Partial<Concert>[];
  error?: string;
  reason?: string;
  htmlSample?: string;
}>;

/**
 * Fetches the live page with the candidate config and runs the plausibility
 * checks on what comes back. Deliberately calls runScraper with no cache entry:
 * a conditional request could answer 304 and verify nothing at all.
 */
export async function verifyConfigLive(
  config: ScraperConfig,
  runScraperFn: RunScraperFn,
  options: VerifyOptions = {}
): Promise<VerifyReport> {
  let result: Awaited<ReturnType<RunScraperFn>>;
  try {
    result = await runScraperFn(config);
  } catch (err: any) {
    return {
      ok: false,
      eventCount: 0,
      checks: [{ name: 'live_fetch', ok: false, detail: `runScraper threw: ${err?.message ?? err}` }]
    };
  }

  if (!result.success) {
    return {
      ok: false,
      eventCount: 0,
      checks: [{
        name: 'live_fetch',
        ok: false,
        detail: `live run failed (reason=${result.reason ?? 'unknown'}): ${result.error ?? 'no error message'}`
      }],
      failureReason: result.reason,
      htmlSample: result.htmlSample
    };
  }

  const report = verifyEvents(result.concerts, config, options);
  report.checks.unshift({ name: 'live_fetch', ok: true, detail: 'live run succeeded' });
  return report;
}

/** One-line summary for logs and the PR body. */
export function formatVerifyReport(report: VerifyReport): string {
  const failed = report.checks.filter((c) => !c.ok);
  if (report.ok) return `PASS (${report.eventCount} events, ${report.checks.length} checks)`;
  return `FAIL: ${failed.map((c) => `${c.name} [${c.detail}]`).join('; ')}`;
}
