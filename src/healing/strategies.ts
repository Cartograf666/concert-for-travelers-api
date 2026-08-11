/**
 * Deterministic (no-LLM) repair strategies.
 *
 * Each strategy turns a broken config into an ordered list of *candidate*
 * configs. It never decides whether a candidate is good -- that is the live
 * verification gate's job (healing/verify.ts). Keeping proposal and acceptance
 * apart means every strategy, including the LLM re-selector, clears the exact
 * same bar before anything is written or merged.
 *
 * Ordering within a plan is cheapest-and-most-likely-first: each candidate costs
 * one live fetch of a third-party site, so the list is capped rather than
 * exhaustive.
 */

import * as cheerio from 'cheerio';
import { ScraperConfig, ScraperConfigSchema, isBlockedHost } from '../schemas/config.js';
import { Classification, RepairStrategy } from './classify.js';

export interface StrategyDeps {
  /** Resolves the hostname; false means NXDOMAIN. Injectable for tests. */
  hostResolves: (hostname: string) => Promise<boolean>;
  /** Raw HTML GET, SSRF-guarded. Injectable for tests. */
  fetchHtml: (url: string) => Promise<string>;
}

export interface CandidatePlan {
  /** Configs to try, in order, against the live verification gate. */
  candidates: ScraperConfig[];
  /** Retire the scraper outright -- nothing to repair. */
  retire: boolean;
  /** Why this plan looks the way it does; echoed into the repair report. */
  note: string;
}

/** Ceiling on live probes per broken scraper, so one dead site can't eat the job's budget. */
export const MAX_CANDIDATES = 6;

/** Path fragments that name a schedule page, most specific first. */
const TOUR_PATH_KEYWORDS = [
  'tour-dates', 'tourdates', 'tour', 'shows', 'events', 'concerts', 'gigs',
  'calendar', 'schedule', 'dates', 'live', 'upcoming', 'performances',
  'whats-on', 'what-s-on', 'on-tour', 'agenda', 'spielplan', 'termine'
];

/** Anchor text that names a schedule page (English plus the languages already in the config set). */
const TOUR_TEXT_KEYWORDS = [
  'tour', 'shows', 'events', 'concerts', 'gigs', 'calendar', 'schedule',
  'dates', 'live', 'upcoming', 'tickets', 'agenda', 'termine', 'spielplan',
  'konzerte', 'veranstaltungen'
];

/** Tried directly when the site exposes no usable links (many sites hide nav behind JS). */
const COMMON_TOUR_PATHS = [
  '/tour', '/tour-dates', '/shows', '/events', '/calendar', '/concerts',
  '/live', '/gigs', '/schedule', '/dates'
];

function withUrl(config: ScraperConfig, url: string): ScraperConfig {
  // Re-parse through the schema so a candidate can never carry a URL the normal
  // config validation would reject (non-http(s), private/loopback host).
  return ScraperConfigSchema.parse({ ...config, url });
}

/**
 * True when `candidate` belongs to the same site as `origin`.
 *
 * Rediscovery reads links out of third-party HTML, which is attacker-controlled
 * input: without this the healer could be walked to any URL an injected <a> names
 * and would then persist it into a committed config. Comparison is on the exact
 * hostname plus the www/apex pair -- deliberately not a suffix match, which would
 * accept `evil-example.com` for `example.com`.
 */
export function isSameSite(origin: string, candidate: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  try {
    const a = new URL(origin);
    const b = new URL(candidate);
    if (!/^https?:$/.test(b.protocol)) return false;
    if (isBlockedHost(b.hostname)) return false;
    return strip(a.hostname) === strip(b.hostname);
  } catch {
    return false;
  }
}

function scoreCandidateUrl(url: string, anchorText: string): number {
  let score = 0;
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return -1;
  }
  TOUR_PATH_KEYWORDS.forEach((kw, i) => {
    if (pathname.includes(kw)) score += 100 - i; // earlier keyword = more specific
  });
  const text = anchorText.trim().toLowerCase();
  for (const kw of TOUR_TEXT_KEYWORDS) {
    if (text === kw) { score += 40; break; }
    if (text.includes(kw)) { score += 20; break; }
  }
  // Prefer shallow paths: /tour beats /blog/2019/our-tour-diary.
  score -= (pathname.split('/').filter(Boolean).length - 1) * 5;
  return score;
}

/**
 * Ranks same-site links from a page by how much they look like a schedule page.
 * Exported for testing -- the ranking is the part most likely to regress.
 */
export function rankTourUrlCandidates(html: string, baseUrl: string, excludeUrl?: string): string[] {
  const $ = cheerio.load(html);
  const scored = new Map<string, number>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!isSameSite(baseUrl, abs)) return;
    const normalized = abs.split('#')[0];
    if (excludeUrl && normalized === excludeUrl.split('#')[0]) return;
    const score = scoreCandidateUrl(normalized, $(el).text());
    if (score <= 0) return;
    const prev = scored.get(normalized);
    if (prev === undefined || score > prev) scored.set(normalized, score);
  });

  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);
}

/** Swaps www. for the apex and vice versa -- the usual shape of a cert-altname mismatch. */
export function swapWwwVariant(url: string): string | null {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith('www.')
      ? u.hostname.slice(4)
      : `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}

async function planUrlMoved(config: ScraperConfig, deps: StrategyDeps): Promise<CandidatePlan> {
  const origin = new URL(config.url).origin;
  const urls: string[] = [];

  // 1. Links on the site's own front page.
  try {
    const html = await deps.fetchHtml(origin);
    urls.push(...rankTourUrlCandidates(html, config.url, config.url));
  } catch (err: any) {
    // The root failing too is informative but not fatal -- the fixed-path guesses
    // below still have a chance (some sites 404 the root but serve /tour).
    console.warn(`[Strategy] ${config.id}: could not fetch site root ${origin}: ${err?.message ?? err}`);
  }

  // 2. Conventional paths the nav may not expose as plain links.
  for (const p of COMMON_TOUR_PATHS) {
    const guess = `${origin}${p}`;
    if (guess !== config.url) urls.push(guess);
  }

  const unique = Array.from(new Set(urls)).slice(0, MAX_CANDIDATES);
  const candidates: ScraperConfig[] = [];
  for (const u of unique) {
    try {
      candidates.push(withUrl(config, u));
    } catch {
      // Schema rejected the URL (blocked host / bad protocol) -- drop it silently.
    }
  }

  return {
    candidates,
    retire: false,
    note: `url_moved: probing ${candidates.length} candidate schedule URL(s) on ${origin}`
  };
}

async function planDeadDomain(config: ScraperConfig, deps: StrategyDeps): Promise<CandidatePlan> {
  const hostname = new URL(config.url).hostname;
  const resolves = await deps.hostResolves(hostname);
  if (!resolves) {
    return { candidates: [], retire: true, note: `dead_domain: ${hostname} does not resolve` };
  }
  // DNS answers now -- the fail-log entry was a resolver blip or the domain came
  // back. Do not retire; re-probe the original URL with escalated retries.
  return {
    candidates: [ScraperConfigSchema.parse({ ...config, maxRetries: 4 })],
    retire: false,
    note: `dead_domain reclassified: ${hostname} resolves now, retrying instead of retiring`
  };
}

async function planTlsBroken(config: ScraperConfig, deps: StrategyDeps): Promise<CandidatePlan> {
  const hostname = new URL(config.url).hostname;
  const resolves = await deps.hostResolves(hostname);
  if (!resolves) {
    return { candidates: [], retire: true, note: `tls_broken + NXDOMAIN: ${hostname} is gone` };
  }
  const candidates: ScraperConfig[] = [];
  const swapped = swapWwwVariant(config.url);
  if (swapped) {
    try {
      candidates.push(withUrl(config, swapped));
    } catch {
      // ignore an unusable variant
    }
  }
  return {
    candidates,
    retire: false,
    note: candidates.length
      ? 'tls_broken: trying the www/apex variant, which usually holds the valid certificate'
      : 'tls_broken: no usable hostname variant to try'
  };
}

function planAntiBot(config: ScraperConfig): CandidatePlan {
  if (config.httpClient === 'got-scraping') {
    return {
      candidates: [],
      retire: false,
      note: 'anti_bot: already on the got-scraping backend, no further escalation available'
    };
  }
  return {
    candidates: [
      ScraperConfigSchema.parse({ ...config, httpClient: 'got-scraping' }),
      // Second pass adds politeness: some filters key on request rate, not headers.
      ScraperConfigSchema.parse({
        ...config,
        httpClient: 'got-scraping',
        maxRetries: 3,
        requestDelayMs: Math.max(config.requestDelayMs ?? 0, 3000)
      })
    ],
    retire: false,
    note: 'anti_bot: escalating to the got-scraping header-fingerprint backend'
  };
}

function planTransient(config: ScraperConfig): CandidatePlan {
  const current = config.maxRetries ?? 2;
  if (current >= 5) {
    return { candidates: [], retire: false, note: 'transient: retries already at the schema maximum' };
  }
  return {
    candidates: [
      ScraperConfigSchema.parse({
        ...config,
        maxRetries: 5,
        requestDelayMs: Math.max(config.requestDelayMs ?? 0, 2000)
      })
    ],
    retire: false,
    note: `transient: raising maxRetries ${current} -> 5 with a politeness delay`
  };
}

function planNeedsRender(config: ScraperConfig): CandidatePlan {
  if (config.type === 'playwright_render') {
    return { candidates: [], retire: false, note: 'needs_render: already a rendering scraper' };
  }
  return {
    candidates: [ScraperConfigSchema.parse({ ...config, type: 'playwright_render' })],
    retire: false,
    note: "needs_render: switching type to 'playwright_render' so client-side events materialize"
  };
}

/**
 * Builds the ordered candidate list for a classified failure.
 *
 * `selectors` returns nothing here on purpose: that path goes through
 * healing/repair.ts (JSON-LD probe, then the LLM), and its output is fed into the
 * same verification gate by heal.ts.
 */
export async function proposeRepairCandidates(
  config: ScraperConfig,
  classification: Classification,
  deps: StrategyDeps
): Promise<CandidatePlan> {
  const strategy: RepairStrategy = classification.strategy;
  switch (strategy) {
    case 'dead_domain':
      return planDeadDomain(config, deps);
    case 'tls_broken':
      return planTlsBroken(config, deps);
    case 'url_moved':
      return planUrlMoved(config, deps);
    case 'anti_bot':
      return planAntiBot(config);
    case 'transient':
      return planTransient(config);
    case 'needs_render':
      return planNeedsRender(config);
    case 'selectors':
      return { candidates: [], retire: false, note: 'selectors: handled by the JSON-LD/LLM repair path' };
    case 'unfixable':
    default:
      return { candidates: [], retire: false, note: `no candidates for strategy "${strategy}"` };
  }
}
