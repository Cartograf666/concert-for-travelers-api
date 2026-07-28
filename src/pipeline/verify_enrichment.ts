import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dns from 'dns';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Post-enrichment VERIFIER for the collected artist metadata.
 *
 * Why this exists: enrich.ts asks Gemini to "find the official website/socials"
 * purely from model memory -- no grounding, no check that the URL exists. On
 * obscure/ambiguous names that recall confidently hallucinates (observed live:
 * an artist enriched with a website whose domain doesn't even resolve, a tourUrl
 * derived from it, and a Spotify id that 404s). This pass re-checks what was
 * collected and removes what is provably wrong.
 *
 * Two layers, deliberately NOT "ask Gemini to check its own answer" (which would
 * just re-confirm the hallucination):
 *   1. Deterministic reachability -- DNS + HTTP. Truthful, zero LLM. A domain
 *      that doesn't resolve or 404s is dead, full stop.
 *   2. Grounded LLM identity -- ONLY for links that are actually reachable, the
 *      model judges the REAL fetched page content (title + snippet) against the
 *      artist name: is this the official page of THIS artist, or a namesake /
 *      parked domain / aggregator? The model reads evidence, it doesn't recall.
 *
 * Null policy (conservative -- only ever removes data on strong evidence):
 *   - deterministic dead (DNS fail / 404 / 410)      -> null the field
 *   - reachable + grounded LLM "mismatch"            -> null the field
 *   - blocked (401/403/429), timeout, unreachable    -> KEEP (infra, not proof)
 *   - reachable + "match"/"unsure"                    -> keep
 * Never nulls on an inconclusive signal, so a site that merely blocks our fetch
 * or is unreachable from the runner is never mistaken for bad data.
 */

export type Reach = 'ok' | 'dead' | 'blocked' | 'unreachable' | 'unknown';
export type Identity = 'match' | 'mismatch' | 'unsure';

export interface FetchResult {
  status: number;
  finalUrl?: string;
  body?: string;
  error?: string; // 'dns' | 'timeout' | node error code
}
export type FetchFn = (url: string, opts?: { method?: 'GET' | 'HEAD' }) => Promise<FetchResult>;

export interface JudgeItem { url: string; name: string; evidence: string }
/** Maps each item url -> grounded identity verdict. Missing url => treat as 'unsure'. */
export type JudgeFn = (items: JudgeItem[]) => Promise<Record<string, Identity>>;

export interface FieldVerdict {
  field: 'website' | 'tourUrl' | 'spotify' | 'instagram' | 'facebook' | 'youtube' | 'telegram' | 'vk';
  url: string;
  reach: Reach;
  identity?: Identity;
  action: 'keep' | 'null';
  note?: string;
}
export interface VerifyResult {
  name: string;
  verdicts: FieldVerdict[];
  changed: boolean;
  nulledFields: string[];
}

const SOCIAL_FIELDS = ['instagram', 'facebook', 'youtube', 'telegram', 'vk'] as const;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Classify an HTTP/DNS result into a reachability bucket used by the null policy. */
export function classifyReach(r: FetchResult): Reach {
  if (r.error === 'dns') return 'dead';
  if (r.status === 0) return 'unreachable'; // timeout / connection refused / reset
  if (r.status === 404 || r.status === 410) return 'dead';
  if (r.status === 401 || r.status === 403 || r.status === 429) return 'blocked';
  if (r.status >= 200 && r.status < 400) return 'ok';
  return 'unknown';
}

/** Loose token overlap: any >=4-char token of `name` present in `text` (both folded). */
export function nameMatches(name: string, text: string): boolean {
  if (!text) return false;
  const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ');
  const hay = fold(text);
  const toks = fold(name).split(/\s+/).filter((t) => t.length >= 4);
  if (toks.length === 0) {
    // Very short names ("M83", "10cc"): fall back to exact folded-substring on the whole name.
    const whole = fold(name).trim();
    return whole.length > 0 && hay.includes(whole);
  }
  return toks.some((t) => hay.includes(t));
}

function hostOf(url: string): string | null {
  try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

/** Extract a compact evidence string (title + leading visible text) from HTML. */
export function pageEvidence(finalUrl: string | undefined, body: string | undefined): string {
  const title = body?.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? '';
  const text = (body ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  return `URL: ${finalUrl ?? ''}\nTITLE: ${title}\nTEXT: ${text}`;
}

/**
 * Spotify verification without the LLM: the public oembed endpoint returns the
 * artist's canonical name for a valid id and 404s for an invalid one -- so we get
 * both "does it resolve" and "is it the right artist" deterministically.
 */
async function verifySpotify(url: string, name: string, fetchFn: FetchFn): Promise<FieldVerdict> {
  const base: FieldVerdict = { field: 'spotify', url, reach: 'unknown', action: 'keep' };
  const m = url.match(/artist\/([A-Za-z0-9]+)/);
  if (!m || !/^[0-9A-Za-z]{22}$/.test(m[1])) {
    return { ...base, reach: 'dead', action: 'null', note: 'malformed spotify id' };
  }
  const r = await fetchFn('https://open.spotify.com/oembed?url=' + encodeURIComponent(url));
  const reach = classifyReach(r);
  if (reach === 'dead') return { ...base, reach, action: 'null', note: 'oembed 404 (invalid id)' };
  if (reach !== 'ok') return { ...base, reach, action: 'keep', note: 'inconclusive (infra)' };
  let title = '';
  try { title = JSON.parse(r.body || '{}').title || ''; } catch { /* ignore */ }
  if (title && !nameMatches(name, title) && !nameMatches(title, name)) {
    return { ...base, reach, identity: 'mismatch', action: 'null', note: `oembed name "${title}" != artist` };
  }
  return { ...base, reach, identity: title ? 'match' : 'unsure', action: 'keep' };
}

// ---------------------------------------------------------------------------
// Per-entry verification
// ---------------------------------------------------------------------------

/**
 * Verifies every URL field on one artist entry and returns the actions + a
 * mutated copy is NOT produced here -- caller applies nulls via applyVerdicts so
 * the write step stays in one place (matches enrich.ts's single-writer rule).
 */
export async function verifyEntry(entry: ArtistEntry, fetchFn: FetchFn, judgeFn: JudgeFn): Promise<VerifyResult> {
  const name = entry.name;
  const verdicts: FieldVerdict[] = [];

  // 1. Reachability for website + tourUrl (fetch bodies -- needed for grounding).
  const webUrl = entry.website || null;
  const tourUrl = entry.tourUrl || null;
  const [webRes, tourRes] = await Promise.all([
    webUrl ? fetchFn(webUrl) : Promise.resolve(null),
    tourUrl ? fetchFn(tourUrl) : Promise.resolve(null)
  ]);

  const webReach = webRes ? classifyReach(webRes) : null;
  const tourReach = tourRes ? classifyReach(tourRes) : null;

  // 2. Build the judge queue from ONLY the reachable link(s). tourUrl on the same
  //    host as a matching website inherits the verdict (saves an LLM call -- 94%
  //    of tourUrls share the website host).
  const judgeQueue: JudgeItem[] = [];
  if (webUrl && webReach === 'ok') judgeQueue.push({ url: webUrl, name, evidence: pageEvidence(webRes!.finalUrl, webRes!.body) });
  const tourSharesWebHost = !!(webUrl && tourUrl && hostOf(webUrl) && hostOf(webUrl) === hostOf(tourUrl));
  if (tourUrl && tourReach === 'ok' && !tourSharesWebHost) {
    judgeQueue.push({ url: tourUrl, name, evidence: pageEvidence(tourRes!.finalUrl, tourRes!.body) });
  }
  const judged = judgeQueue.length > 0 ? await judgeFn(judgeQueue) : {};

  // 3. website verdict
  if (webUrl) {
    if (webReach === 'dead') verdicts.push({ field: 'website', url: webUrl, reach: 'dead', action: 'null', note: webRes!.error === 'dns' ? 'domain does not resolve' : `http ${webRes!.status}` });
    else if (webReach === 'ok') {
      const id = judged[webUrl] ?? 'unsure';
      verdicts.push({ field: 'website', url: webUrl, reach: 'ok', identity: id, action: id === 'mismatch' ? 'null' : 'keep', note: id === 'mismatch' ? 'page is not this artist' : undefined });
    } else verdicts.push({ field: 'website', url: webUrl, reach: webReach!, action: 'keep', note: 'inconclusive (infra)' });
  }

  // 4. tourUrl verdict
  if (tourUrl) {
    if (tourReach === 'dead') verdicts.push({ field: 'tourUrl', url: tourUrl, reach: 'dead', action: 'null', note: tourRes!.error === 'dns' ? 'domain does not resolve' : `http ${tourRes!.status}` });
    else if (tourReach === 'ok') {
      // Inherit website's identity when same-host; else use its own judge verdict.
      const webVerdict = verdicts.find((v) => v.field === 'website');
      const id: Identity = tourSharesWebHost && webVerdict?.identity ? webVerdict.identity : (judged[tourUrl] ?? 'unsure');
      verdicts.push({ field: 'tourUrl', url: tourUrl, reach: 'ok', identity: id, action: id === 'mismatch' ? 'null' : 'keep', note: id === 'mismatch' ? 'page is not this artist' : (tourSharesWebHost ? 'inherited website verdict' : undefined) });
    } else verdicts.push({ field: 'tourUrl', url: tourUrl, reach: tourReach!, action: 'keep', note: 'inconclusive (infra)' });
  }

  // 5. spotify (deterministic oembed)
  const socials = entry.socials || {};
  if (socials.spotify) verdicts.push(await verifySpotify(socials.spotify, name, fetchFn));

  // 6. other socials -- reachability only (bot walls make identity unreliable; only
  //    null on a definitively dead link, never on a 200-that-might-be-wrong).
  const socialResults = await Promise.all(
    SOCIAL_FIELDS.filter((f) => socials[f]).map(async (f) => ({ f, r: await fetchFn(socials[f] as string, { method: 'HEAD' }) }))
  );
  for (const { f, r } of socialResults) {
    const reach = classifyReach(r);
    verdicts.push({ field: f, url: socials[f] as string, reach, action: reach === 'dead' ? 'null' : 'keep', note: reach === 'dead' ? (r.error === 'dns' ? 'domain does not resolve' : `http ${r.status}`) : undefined });
  }

  const nulledFields = verdicts.filter((v) => v.action === 'null').map((v) => v.field);
  return { name, verdicts, changed: nulledFields.length > 0, nulledFields };
}

/** Applies a VerifyResult's null actions to a copy of the entry and stamps verifiedAt. */
export function applyVerdicts(entry: ArtistEntry, result: VerifyResult, now: string): ArtistEntry {
  const updated: ArtistEntry = { ...entry, socials: { ...(entry.socials || {}) }, verifiedAt: now } as ArtistEntry;
  for (const v of result.verdicts) {
    if (v.action !== 'null') continue;
    if (v.field === 'website') updated.website = null;
    else if (v.field === 'tourUrl') updated.tourUrl = null;
    else (updated.socials as Record<string, unknown>)[v.field] = null;
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Default network + LLM implementations (injected in prod, mocked in tests)
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Resolver-health preflight. The only field-nulling signal that depends on the
 * environment's DNS (rather than a real HTTP status) is ENOTFOUND -> 'dead'. But
 * a degraded/throttled resolver returns ENOTFOUND for domains that plainly exist
 * (observed live: instagram.com/facebook.com both ENOTFOUND in one window while
 * spotify resolved). Since nulling is destructive, the sweep must refuse to run
 * when the resolver itself is unhealthy -- otherwise a transient DNS blip would
 * wipe live websites/socials across the catalog. Returns true only if a majority
 * of stable control domains resolve. Injectable lookup for testing.
 */
export async function resolverHealthy(
  controls: string[] = ['google.com', 'cloudflare.com', 'github.com', 'amazon.com'],
  lookup: (h: string) => Promise<unknown> = (h) => dns.promises.lookup(h)
): Promise<boolean> {
  const oks = await Promise.all(controls.map((h) => lookup(h).then(() => true).catch(() => false)));
  return oks.filter(Boolean).length >= Math.ceil(controls.length / 2);
}

/**
 * Confirms a host is really NXDOMAIN before letting it null a link. A single
 * ENOTFOUND is not trusted: transient resolver failures (and EAI_AGAIN) return it
 * for domains that exist, so we retry with backoff and only declare 'dns'-dead if
 * EVERY attempt says ENOTFOUND. Combined with the resolverHealthy() gate the sweep
 * runs behind, this makes a blip unable to mass-null live data.
 *
 * Known limitation: an environment that persistently egress-blocks a specific
 * host's DNS (observed in one sandbox for social domains) will still report it
 * ENOTFOUND on every retry -- so run this sweep from the same CI environment that
 * scrapes/enriches, where target hosts resolve normally, not from a restricted box.
 */
async function isNxdomain(host: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
    try { await dns.promises.lookup(host); return false; } // resolved -> not dead
    catch (e: any) { if (e?.code !== 'ENOTFOUND') return false; } // EAI_AGAIN/other -> inconclusive, not dead
  }
  return true; // ENOTFOUND on every attempt
}

/** Real fetch: DNS pre-check (a confirmed NXDOMAIN host is dead without an HTTP attempt), then GET/HEAD with a hard timeout. */
export const defaultFetch: FetchFn = async (url, opts) => {
  let host: string;
  try { host = new URL(url).hostname; } catch { return { status: 0, error: 'bad-url' }; }
  if (await isNxdomain(host)) return { status: 0, error: 'dns' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { method: opts?.method ?? 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    let body = '';
    if ((opts?.method ?? 'GET') === 'GET') { try { body = (await res.text()).slice(0, 80000); } catch { /* ignore */ } }
    return { status: res.status, finalUrl: res.url, body };
  } catch (e: any) {
    return { status: 0, error: e?.name === 'AbortError' ? 'timeout' : (e?.cause?.code || e?.message || 'fetch-error') };
  } finally { clearTimeout(t); }
};

// Same cascade philosophy as enrich.ts: cheap high-quota models first.
export const DEFAULT_JUDGE_MODELS = [
  'gemma-4-26b', 'gemma-4-31b',
  'gemini-3.1-flash-lite', 'gemini-3-flash',
  'gemini-2.5-flash', 'gemini-2.5-flash-lite'
];

function isAuthOrQuotaError(err: any): boolean {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if (status === 401 || status === 403 || status === 404 || status === 429) return true;
  return /\b(401|403|404|429)\b|quota|rate.?limit|not found/i.test(err?.message || '');
}

/** Builds a grounded identity-judge that rotates keys/models like the enricher. */
export function makeGeminiJudge(apiKeys: string[], models: string[] = DEFAULT_JUDGE_MODELS): JudgeFn {
  const keys = apiKeys.filter(Boolean);
  return async (items) => {
    if (items.length === 0 || keys.length === 0) return {};
    const prompt = `You are verifying whether web pages are the OFFICIAL page of a given music artist/band.
For each item you are given the artist name and the ACTUAL fetched content of the page (title + text snippet). Judge ONLY from the provided content -- do not use outside knowledge or guess from the URL.

Return "match" if the page clearly belongs to that artist, "mismatch" if it is a different entity / parked domain / error / unrelated page, or "unsure" if the snippet is insufficient.

Items:
${JSON.stringify(items.map((it, i) => ({ i, artist: it.name, page: it.evidence })), null, 2)}

Output ONLY a raw JSON array (no markdown fences): [{"i": 0, "verdict": "match|mismatch|unsure"}, ...] with one object per item index.`;

    const exhausted = new Set<string>();
    let keyIdx = 0;
    let text: string | null = null;
    while (text === null) {
      for (const model of models) {
        if (exhausted.has(model)) continue;
        try {
          const genAI = new GoogleGenerativeAI(keys[keyIdx]);
          const res = await genAI.getGenerativeModel({ model }).generateContent(prompt);
          text = res.response.text();
          break;
        } catch (err: any) {
          if (isAuthOrQuotaError(err)) exhausted.add(model);
        }
      }
      if (text !== null) break;
      if (keyIdx < keys.length - 1) { keyIdx++; exhausted.clear(); continue; }
      return {}; // all keys/models exhausted -> no verdicts (everything stays 'unsure' -> kept)
    }

    let parsed: Array<{ i: number; verdict: Identity }> = [];
    try {
      let c = text.trim();
      if (c.startsWith('```')) c = c.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(c);
    } catch { return {}; }
    const out: Record<string, Identity> = {};
    for (const p of parsed) {
      const item = items[p.i];
      if (item && (p.verdict === 'match' || p.verdict === 'mismatch' || p.verdict === 'unsure')) out[item.url] = p.verdict;
    }
    return out;
  };
}
