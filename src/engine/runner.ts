import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium, type Browser } from 'playwright';
import { circuitBreaker, ConsecutiveBreaker, BrokenCircuitError, handleWhen } from 'cockatiel';
import { ScraperConfig, ScraperConfigSchema, isBlockedHost } from '../schemas/config.js';
import { Concert } from '../schemas/concert.js';
import { extractJsonLd } from './structured.js';
import { safeAbsoluteUrl } from './url.js';
import { VenueCache, ScrapeCache, hashConcerts } from './cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as dns from 'dns';

// SSRF guard at CONNECT time: validate every resolved IP, not just the literal config.url.
// This is what defends against a public host that 302-redirects to 169.254.169.254, a
// DNS name that resolves to a private IP (rebinding), and integer/hex IP encodings the
// static string check can't canonicalize -- axios follows redirects through these agents,
// so each hop's resolved address is checked.
// Escape hatch for the test suite, which scrapes mock servers on localhost. Prod (npm run
// scrape / CI) never sets this, so real runs still block private/loopback/metadata targets.
const ALLOW_LOCAL_HOSTS = process.env.SCRAPER_ALLOW_LOCAL_HOSTS === '1';
function hostBlocked(h: string): boolean {
  return !ALLOW_LOCAL_HOSTS && isBlockedHost(h);
}

function safeLookup(hostname: string, options: any, callback?: any): void {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;
  dns.lookup(hostname, opts, (err: any, address: any, family: any) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? address : [{ address, family }];
    for (const a of list) {
      if (hostBlocked(String(a.address))) {
        return cb(new Error(`Blocked SSRF target: ${hostname} -> ${a.address}`));
      }
    }
    cb(err, address, family);
  });
}

const ssrfHttpAgent = new http.Agent({ lookup: safeLookup as any });
const ssrfHttpsAgent = new https.Agent({ lookup: safeLookup as any });

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const DEFAULT_MAX_RETRIES = 2;
const HTML_SAMPLE_LIMIT = 60000; // large enough to keep JSON-LD / hydration blocks intact for the healer

/**
 * Why a scrape produced no usable events. Lets the healer skip pages the LLM
 * cannot fix (CSR shells, genuinely empty schedules) instead of burning calls.
 */
export type FailureReason = 'fetch_error' | 'csr_detected' | 'empty_schedule' | 'selectors_stale' | 'parse_error' | 'circuit_open';

export interface ScraperResult {
  configId: string;
  success: boolean;
  concerts: Partial<Concert>[];
  error?: string;
  reason?: FailureReason;
  htmlSample?: string;
  scrapedAt: string;
  // Change-detection metadata for the per-venue cache:
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  notModified?: boolean; // events identical to the cached run (304 or matching hash)
}

// Per-domain last-access timestamps for polite request throttling.
const lastAccessByDomain = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Per-domain circuit breakers: after 3 consecutive full (post-retry) failures
// against the same domain, stop hammering it for a cooldown period instead of
// retrying into an active block (e.g. a site throttling/resetting connections
// after repeated automated requests). Built lazily, one per domain, and reused
// across the whole scrape run.
const breakersByDomain = new Map<string, ReturnType<typeof circuitBreaker>>();
const CIRCUIT_HALF_OPEN_AFTER_MS = 5 * 60_000;
const CIRCUIT_CONSECUTIVE_FAILURES = 3;

function getBreaker(domain: string): ReturnType<typeof circuitBreaker> {
  let breaker = breakersByDomain.get(domain);
  if (!breaker) {
    breaker = circuitBreaker(handleWhen(() => true), {
      halfOpenAfter: CIRCUIT_HALF_OPEN_AFTER_MS,
      breaker: new ConsecutiveBreaker(CIRCUIT_CONSECUTIVE_FAILURES)
    });
    breakersByDomain.set(domain, breaker);
  }
  return breaker;
}

/** True for transient failures worth retrying (network drop, timeout, 429, 5xx). */
function isRetryableError(err: any): boolean {
  if (!err) return false;
  if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return true;
  }
  const status = err.response?.status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  // No response at all (network layer error) -> retry.
  return err.request !== undefined && err.response === undefined;
}

/**
 * Heuristic: the fetched HTML is a client-side-rendered shell whose real content
 * only appears after JS runs, so stale-selector healing would be pointless.
 */
function isLikelyCsr(html: string): boolean {
  if (/id="__NEXT_DATA__"|__NUXT__|window\.__INITIAL_STATE__|data-reactroot/.test(html)) {
    // Framework hydration markers with no extractable events -> browser-only content.
    return true;
  }
  const emptyRoot = /<(div|main)[^>]*id="(root|app|__next|__nuxt)"[^>]*>\s*<\/(div|main)>/i.test(html);
  return emptyRoot;
}

/**
 * Loads all scraper configurations from the given directory.
 */
export async function loadConfigs(scrapersDir: string): Promise<ScraperConfig[]> {
  let files: string[];
  try {
    files = await fs.readdir(scrapersDir);
  } catch (error: any) {
    throw new Error(`Failed to load scraper configurations: ${error.message}`);
  }

  const configs: ScraperConfig[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(scrapersDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      configs.push(ScraperConfigSchema.parse(parsed));
    } catch (error: any) {
      // Isolate a single malformed/invalid config so it can't abort the whole daily run.
      console.warn(`[Runner] Skipping invalid scraper config ${file}: ${error.message}`);
    }
  }
  return configs;
}

/**
 * Runs a single static selector-based scraper.
 */
async function runStaticScraper(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (!config.selectors) {
    throw new Error(`Selectors are missing for static scraper config: ${config.id}`);
  }

  const $ = cheerio.load(html);
  const concerts: Partial<Concert>[] = [];
  const { eventBlock, artist, artistNameFallback, date, ticketUrl, venue, city, country, venueNameFallback, cityNameFallback, countryNameFallback, lat, lng } = config.selectors;

  $(eventBlock).each((_, element) => {
    const block = $(element);

    // Extract artist text; single-artist tour pages carry no per-row name, use the fixed fallback
    const artistText = (artist ? block.find(artist).text().trim() : '') || artistNameFallback || '';

    // Extract date text
    const dateText = block.find(date).text().trim();

    // Per-row venue/city/country (artist tour pages); empty when selector absent
    const venueText = venue ? block.find(venue).text().trim() : '';
    const cityText = city ? block.find(city).text().trim() : '';
    const countryText = country ? block.find(country).text().trim() : '';

    // Extract ticket/info URL
    let absoluteTicketUrl: string | undefined;
    if (ticketUrl) {
      const ticketEl = block.find(ticketUrl);
      let href = ticketEl.attr('href');

      // Fallback: check if the block itself is an anchor tag and we selected it
      if (!href && block.is('a')) {
        href = block.attr('href');
      }

      if (href) {
        absoluteTicketUrl = safeAbsoluteUrl(href, config.url);
      }
    }

    if (artistText && dateText) {
      concerts.push({
        artist: artistText,
        // We leave date normalization and validation to the pipeline
        date: dateText,
        venue: venueText || venueNameFallback,
        city: cityText || cityNameFallback,
        country: countryText || countryNameFallback,
        // Only attach the geocoded coordinate when this row is at the scraper's own
        // fixed venue -- a per-row tour-page venue (venueText set) has different,
        // unknown coordinates, so lat/lng must not be carried over from the fallback.
        ...(venueText ? {} : { lat, lng }),
        ticketUrl: absoluteTicketUrl,
        originalSource: config.domain,
        scrapedAt
      });
    }
  });

  return concerts;
}

/**
 * Resolve a nested path supporting dots and array indices, e.g.
 * "data.events", "props.pageProps.events[0].items", or "data.pages.0.events".
 */
function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  // Normalize bracket indices (foo[0]) into dot segments (foo.0), then split.
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((p) => p.length > 0);
  return parts.reduce((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    return acc[part];
  }, obj);
}

/**
 * Runs a single JSON API-based scraper.
 */
async function runJsonApiScraper(config: ScraperConfig, jsonData: any, scrapedAt: string): Promise<Partial<Concert>[]> {
  if (!config.selectors) {
    throw new Error(`Selectors are missing for JSON API scraper config: ${config.id}`);
  }

  const { eventBlock, artist, artistNameFallback, date, ticketUrl, venue, city, country, venueNameFallback, cityNameFallback, countryNameFallback, lat, lng } = config.selectors;

  const events = getByPath(jsonData, eventBlock);
  if (!events) {
    throw new Error(`Could not find events array at path "${eventBlock}" in JSON response.`);
  }

  const eventsArray = Array.isArray(events) ? events : [events];
  const concerts: Partial<Concert>[] = [];

  for (const item of eventsArray) {
    const artistText = (artist ? String(getByPath(item, artist) || '').trim() : '') || artistNameFallback || '';
    const dateText = String(getByPath(item, date) || '').trim();
    const venueText = venue ? String(getByPath(item, venue) || '').trim() : '';
    const cityText = city ? String(getByPath(item, city) || '').trim() : '';
    const countryText = country ? String(getByPath(item, country) || '').trim() : '';

    let absoluteTicketUrl: string | undefined;
    if (ticketUrl) {
      const ticketLink = getByPath(item, ticketUrl);
      if (ticketLink) {
        const href = String(ticketLink).trim();
        absoluteTicketUrl = safeAbsoluteUrl(href, config.url);
      }
    }

    if (artistText && dateText) {
      concerts.push({
        artist: artistText,
        date: dateText,
        venue: venueText || venueNameFallback,
        city: cityText || cityNameFallback,
        country: countryText || countryNameFallback,
        ...(venueText ? {} : { lat, lng }),
        ticketUrl: absoluteTicketUrl,
        originalSource: config.domain,
        scrapedAt
      });
    }
  }

  return concerts;
}

/**
 * Runs a Next.js/Nuxt hydration-JSON scraper: reads the inline __NEXT_DATA__
 * (or __NUXT_DATA__) blob and maps events out of it using the same dot/array
 * path machinery as json_api. Generalizes bespoke per-venue custom modules.
 */
async function runNextDataScraper(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').html() || $('#__NUXT_DATA__').html();
  if (!raw) {
    throw new Error('No __NEXT_DATA__/__NUXT_DATA__ hydration script found in page.');
  }
  const data = JSON.parse(raw);
  return runJsonApiScraper(config, data, scrapedAt);
}

/**
 * Runs a single custom JS scraper (looks for custom module under src/engine/custom/{id}.ts or js).
 */
async function runCustomJsScraper(config: ScraperConfig, html: string, scrapedAt: string): Promise<Partial<Concert>[]> {
  // Consistent with runStaticScraper/runJsonApiScraper: fail fast and loudly
  // rather than letting a custom module silently produce undefined venue/city/
  // country fields via optional chaining.
  if (!config.selectors) {
    throw new Error(`Selectors are missing for custom_js scraper config: ${config.id}`);
  }

  // Defense-in-depth: the schema already restricts `id` to [a-z0-9-], but re-check here
  // before interpolating it into a dynamic import specifier so a config that reached this
  // path unvalidated can never load a module outside src/engine/custom/.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.id)) {
    throw new Error(`Refusing to load custom module for unsafe scraper id: ${config.id}`);
  }

  // We dynamic import the custom implementation if it exists
  const customModulePath = `./custom/${config.id}.js`;
  try {
    const customScraper = await import(customModulePath);
    if (typeof customScraper.scrape !== 'function') {
      throw new Error(`Module ${customModulePath} does not export a "scrape" function.`);
    }
    return await customScraper.scrape(config, html, scrapedAt);
  } catch (err: any) {
    throw new Error(`Failed to execute custom JS scraper for ${config.id}: ${err.message}`);
  }
}

/**
 * Enforces the per-domain politeness delay. Reserves the next slot optimistically
 * so concurrent workers hitting the same domain space themselves out.
 */
async function politeDelay(config: ScraperConfig): Promise<void> {
  const minGap = config.requestDelayMs ?? 0;
  if (minGap <= 0) return;
  const now = Date.now();
  const last = lastAccessByDomain.get(config.domain) ?? 0;
  const scheduled = Math.max(now, last + minGap);
  lastAccessByDomain.set(config.domain, scheduled);
  const wait = scheduled - now;
  if (wait > 0) await sleep(wait);
}

/**
 * Fetches the target URL with exponential backoff + jitter on transient errors
 * (network drop, timeout, 429, 5xx). Non-transient errors fail fast.
 */
interface FetchResponse {
  status: number;
  data: any;
  headers: Record<string, any>;
}

async function fetchWithRetry(config: ScraperConfig, conditional?: { etag?: string; lastModified?: string }): Promise<FetchResponse> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastErr: any = null;

  const headers: Record<string, string> = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };
  // Conditional request: ask the server to answer 304 if nothing changed.
  if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
  if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(15000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      console.warn(`[Runner] ${config.id}: transient fetch error, retry ${attempt}/${maxRetries} in ${backoff}ms`);
      await sleep(backoff);
    }
    await politeDelay(config);
    try {
      const response = await axios.get(config.url, {
        headers,
        timeout: 15000, // 15s timeout (some venue pages ship large SSR/Next.js payloads)
        httpAgent: ssrfHttpAgent,
        httpsAgent: ssrfHttpsAgent,
        maxRedirects: 3, // follow a few, but every hop's resolved IP is SSRF-checked by the agents
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304
      });
      return { status: response.status, data: response.data, headers: response.headers };
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === maxRetries) throw err;
    }
  }
  throw lastErr;
}

// Shared headless browser for 'playwright_render' scrapers -- launched lazily on
// first use and reused across the whole scrape run (launching Chromium per-config
// would be far slower and heavier than necessary for a handful of JS-rendered SPA
// venues). Stored as a Promise (not the resolved Browser) so concurrent callers
// from runAllScrapers' worker pool all await the same in-flight launch instead of
// each racing to start their own (assigning the promise happens synchronously,
// before the first `await`, closing the race window). Call closeBrowser() once
// the run is done to avoid leaking the browser process.
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/** Closes the shared Playwright browser, if one was launched. Safe to call even
 * if no 'playwright_render' scraper ran (no-op). Call once at the end of a run. */
export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}

/**
 * Renders a page with a headless browser instead of a plain HTTP GET, for sites
 * whose event data only exists after client-side JS runs (no static HTML, no
 * discoverable JSON API/hydration blob for the next_data/json_api paths to use).
 */
async function renderWithPlaywright(config: ScraperConfig): Promise<FetchResponse> {
  const browser = await getBrowser();
  const page = await browser.newPage({ userAgent: getRandomUserAgent() });
  try {
    // SSRF guard for the browser: abort any main/sub-resource request to a private,
    // loopback, link-local or metadata host (covers redirects and JS-issued fetches).
    await page.route('**/*', (route) => {
      let host = '';
      try { host = new URL(route.request().url()).hostname; } catch { return route.abort(); }
      return hostBlocked(host) ? route.abort() : route.continue();
    });
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 20000 });
    const html = await page.content();
    return { status: 200, data: html, headers: {} };
  } finally {
    await page.close();
  }
}

/**
 * Runs a single scraper config.
 */
export async function runScraper(config: ScraperConfig, cached?: VenueCache): Promise<ScraperResult> {
  const scrapedAt = new Date().toISOString();
  let responseData: any = null;
  try {
    const response = await getBreaker(config.domain).execute(() =>
      config.type === 'playwright_render'
        ? renderWithPlaywright(config)
        : fetchWithRetry(config, cached ? { etag: cached.etag, lastModified: cached.lastModified } : undefined)
    );
    const etag = typeof response.headers?.etag === 'string' ? response.headers.etag : undefined;
    const lastModified = typeof response.headers?.['last-modified'] === 'string' ? response.headers['last-modified'] : undefined;

    // 304 Not Modified: the server confirms nothing changed — reuse cached events, skip parsing.
    if (response.status === 304 && cached) {
      console.log(`[Runner] ${config.id}: 304 Not Modified, reusing ${cached.concerts.length} cached events.`);
      return {
        configId: config.id,
        success: true,
        concerts: cached.concerts,
        notModified: true,
        etag: cached.etag,
        lastModified: cached.lastModified,
        contentHash: cached.contentHash,
        scrapedAt: cached.scrapedAt
      };
    }

    responseData = response.data;

    const expectString = () => {
      if (typeof responseData !== 'string') {
        throw new Error(`Response data is not a string. Type: ${typeof responseData}`);
      }
    };

    let concerts: Partial<Concert>[] = [];

    if (config.type === 'static_selectors') {
      expectString();
      concerts = await runStaticScraper(config, responseData, scrapedAt);
      // Free structured-data fallback: before declaring a break, try schema.org
      // JSON-LD, which survives CSS/layout refactors that snap hashed selectors.
      if (concerts.length === 0) {
        const jsonLd = extractJsonLd(config, responseData, scrapedAt);
        if (jsonLd.length > 0) {
          console.log(`[Runner] ${config.id}: selectors matched 0, recovered ${jsonLd.length} via JSON-LD fallback.`);
          concerts = jsonLd;
        }
      }
    } else if (config.type === 'jsonld') {
      expectString();
      concerts = extractJsonLd(config, responseData, scrapedAt);
    } else if (config.type === 'next_data') {
      expectString();
      concerts = await runNextDataScraper(config, responseData, scrapedAt);
    } else if (config.type === 'json_api') {
      const jsonData = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
      concerts = await runJsonApiScraper(config, jsonData, scrapedAt);
    } else if (config.type === 'custom_js') {
      expectString();
      concerts = await runCustomJsScraper(config, responseData, scrapedAt);
    } else if (config.type === 'playwright_render') {
      // Same CSS-selector extraction as static_selectors, just against HTML that
      // was rendered by a real browser instead of a plain HTTP GET.
      expectString();
      concerts = await runStaticScraper(config, responseData, scrapedAt);
      if (concerts.length === 0) {
        const jsonLd = extractJsonLd(config, responseData, scrapedAt);
        if (jsonLd.length > 0) {
          console.log(`[Runner] ${config.id}: selectors matched 0, recovered ${jsonLd.length} via JSON-LD fallback.`);
          concerts = jsonLd;
        }
      }
    } else {
      // Guards against a schema/engine drift: a config.type the schema enum
      // allows but no branch above handles would otherwise silently fall through
      // with concerts=[] and get misreported as "layout might have changed".
      throw new Error(`Unsupported scraper type: "${config.type}" has no matching branch in runScraper.`);
    }

    if (concerts.length === 0) {
      if (config.allowEmpty) {
        // This venue is known to have a genuinely sparse/seasonal schedule --
        // 0 events is a valid result, not a broken-selector signal for the healer.
        console.log(`[Runner] ${config.id}: 0 events, allowEmpty=true, treating as a valid empty schedule.`);
        return { configId: config.id, success: true, concerts: [], reason: 'empty_schedule', scrapedAt };
      }
      // Classify why, so the healer can skip pages an LLM re-selector cannot fix.
      const isCsr = typeof responseData === 'string' && isLikelyCsr(responseData);
      const reason: FailureReason = isCsr ? 'csr_detected' : 'selectors_stale';
      const htmlSample = typeof responseData === 'string' ? responseData.slice(0, HTML_SAMPLE_LIMIT) : undefined;
      return {
        configId: config.id,
        success: false,
        concerts: [],
        error: isCsr
          ? 'Parsed 0 concerts. Page appears client-side rendered (events absent from server HTML).'
          : 'Parsed 0 concerts. Website layout might have changed.',
        reason,
        htmlSample,
        scrapedAt
      };
    }

    const contentHash = hashConcerts(concerts);
    const notModified = !!cached && cached.contentHash === contentHash;
    if (notModified) {
      console.log(`[Runner] ${config.id}: content unchanged (hash match), ${concerts.length} events.`);
    }

    return {
      configId: config.id,
      success: true,
      concerts,
      scrapedAt,
      etag,
      lastModified,
      contentHash,
      notModified
    };
  } catch (error: any) {
    // Circuit open: we never attempted the request, so there's no HTML sample and
    // nothing for the healer to act on -- this domain is being actively blocked,
    // not broken, so skip straight past the generic fetch_error classification.
    if (error instanceof BrokenCircuitError) {
      console.warn(`[Runner] ${config.id}: circuit open for domain ${config.domain} after ${CIRCUIT_CONSECUTIVE_FAILURES} consecutive failures, skipping.`);
      return {
        configId: config.id,
        success: false,
        concerts: [],
        error: `Circuit breaker open for domain ${config.domain}: ${error.message}`,
        reason: 'circuit_open',
        scrapedAt
      };
    }

    // Capture HTML sample for debugging/self-healing (keep JSON-LD/hydration blocks intact).
    const htmlSample = typeof responseData === 'string' ? responseData.slice(0, HTML_SAMPLE_LIMIT) : undefined;
    const reason: FailureReason = responseData === null ? 'fetch_error' : 'parse_error';
    return {
      configId: config.id,
      success: false,
      concerts: [],
      error: error.message,
      reason,
      htmlSample,
      scrapedAt
    };
  }
}

/**
 * Runs a list of scraper configs concurrently, with a maximum concurrency limit.
 */
export async function runAllScrapers(configs: ScraperConfig[], concurrency = 5, cache?: ScrapeCache): Promise<ScraperResult[]> {
  const results: ScraperResult[] = [];
  const remaining = [...configs];

  async function worker() {
    while (remaining.length > 0) {
      const config = remaining.shift();
      if (!config) break;

      console.log(`[Runner] Starting scraper: ${config.id} (${config.url})`);
      try {
        const res = await runScraper(config, cache?.[config.id]);
        results.push(res);
        if (res.success) {
          console.log(`[Runner] Success: ${config.id} extracted ${res.concerts.length} events.`);
        } else {
          console.warn(`[Runner] Failed: ${config.id} - Error: ${res.error}`);
        }
      } catch (err: any) {
        console.error(`[Runner] Critical failure executing ${config.id}: ${err.message}`);
        results.push({
          configId: config.id,
          success: false,
          concerts: [],
          error: err.message,
          scrapedAt: new Date().toISOString()
        });
      }
    }
  }

  // Spawn worker promises
  const workers = Array.from({ length: Math.min(concurrency, configs.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
