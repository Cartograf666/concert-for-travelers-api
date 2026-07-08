import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { isBlockedHost } from '../schemas/config.js';
import { ArtistEntry } from '../schemas/artist.js';

export interface ProbeResult {
  name: string;
  website: string;
  tourUrl: string | null;
  pathPattern: string | null;
  reason: string;
}

const SUFFIXES = [
  '/tour', '/tour-dates', '/tours', '/shows', '/show', '/live',
  '/live-shows', '/events', '/tickets', '/dates', '/concerts',
  '/schedule', '/calendar', '/performances', '/agenda', '/gigs',
  '/konzerte', '/termine'
];

const PATH_KEYWORDS = [
  'tour', 'show', 'live', 'event', 'ticket', 'date', 'concert',
  'gig', 'perform', 'agenda', 'calendar', 'schedule', 'konzert',
  'termin', 'aktuellt'
];

export function buildProbeUrl(website: string, suffix: string): string {
  let base = website.trim();
  if (!/^https?:\/\//i.test(base)) {
    base = 'https://' + base;
  }
  try {
    const url = new URL(base);
    let pathname = url.pathname;
    if (!pathname.endsWith('/')) {
      pathname += '/';
    }
    const cleanSuffix = suffix.startsWith('/') ? suffix.substring(1) : suffix;
    const resolved = new URL(cleanSuffix, new URL(pathname, url.origin));
    return resolved.toString();
  } catch {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanSuffix = suffix.startsWith('/') ? suffix : '/' + suffix;
    return cleanBase + cleanSuffix;
  }
}

export function isSameOrSubdomain(originalUrl: string, resolvedUrl: string): boolean {
  try {
    const orig = new URL(originalUrl);
    const res = new URL(resolvedUrl);
    const origHost = orig.hostname.toLowerCase().replace(/^www\./, '');
    const resHost = res.hostname.toLowerCase().replace(/^www\./, '');
    
    if (origHost === resHost) return true;
    if (resHost.endsWith('.' + origHost)) return true;
    if (origHost.endsWith('.' + resHost)) return true;
    
    const cleanHost = (h: string) => {
      const parts = h.split('.');
      if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'gov', 'edu'].includes(parts[parts.length - 2])) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    };
    return cleanHost(origHost) === cleanHost(resHost);
  } catch {
    return false;
  }
}

export function isHomepageOrSamePath(originalUrl: string, resolvedUrl: string): boolean {
  try {
    const orig = new URL(originalUrl);
    const res = new URL(resolvedUrl);
    
    const cleanPath = (p: string) => p.replace(/\/+$/, '').toLowerCase();
    
    const origPath = cleanPath(orig.pathname);
    const resPath = cleanPath(res.pathname);
    
    if (resPath === '' || resPath === '/' || resPath === '/index.html' || resPath === '/index.php' || resPath === '/home') {
      return true;
    }
    if (origPath === resPath) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function hasMeaningfulPathKeyword(resolvedUrl: string): boolean {
  try {
    const res = new URL(resolvedUrl);
    const resolvedPath = res.pathname.toLowerCase();
    return PATH_KEYWORDS.some(kw => resolvedPath.includes(kw));
  } catch {
    return false;
  }
}

export function analyzeContent(html: string): { ok: boolean; score: number; reason: string } {
  const cleanHtml = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');

  const years = (cleanHtml.match(/\b(2026|2027|2028)\b/g) || []).length;
  const numericDates = (cleanHtml.match(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g) || []).length;
  
  const monthsRegex = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|januar|februar|marz|m&auml;rz|maerz|juni|juli|september|oktober|dezember|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gi;
  const months = (cleanHtml.match(monthsRegex) || []).length;
  
  const daysRegex = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lunes|martes|miercoles|jueves|viernes|sabado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/gi;
  const days = (cleanHtml.match(daysRegex) || []).length;
  
  const keywordsRegex = /\b(ticket|tickets|buy|venue|tour|gigs|live|show|shows|concert|concerts|event|events|performance|performances|termine|schedule|calendar|konzert|konzerte|billet|billets|karten|entradas|agenda|aktuellt)\b/gi;
  const keywords = (cleanHtml.match(keywordsRegex) || []).length;
  
  let score = 0;
  score += years * 2;
  score += numericDates * 2;
  score += months * 1;
  score += days * 0.5;
  if (keywords > 0) score += Math.min(keywords, 5);

  const hasWidget = /widget\.bandsintown\.com|songkick\.com\/widget|ticketmaster\.com\/.*widget/i.test(html);
  if (hasWidget) {
    score += 8;
  }
  
  const ok = score >= 8;
  const reason = `score=${score} (years=${years}, numericDates=${numericDates}, months=${months}, days=${days}, keywords=${keywords}, widget=${hasWidget ? 1 : 0})`;
  
  return { ok, score, reason };
}

const MAX_REDIRECTS = 5;

/**
 * SSRF guard at EVERY redirect hop, not just the literal probe URL. Using
 * `redirect: 'follow'` would let a compromised/malicious site's /tour page
 * 302 to an internal or cloud-metadata target (GitHub-hosted runners are on
 * Azure -- 169.254.169.254 is a real, live target there, not theoretical --
 * see isBlockedHost's own doc comment in schemas/config.ts, and the identical
 * concern already solved for the main scraper engine via runner.ts's
 * safeLookup-wrapped agents). `redirect: 'manual'` + validating each Location
 * header's hostname before following it closes the same gap here without
 * pulling in axios/a custom dns.lookup agent (this keeps the function's
 * single-fetch-per-hop shape the existing tests already mock against).
 */
async function fetchHelper(url: string, method: 'GET' | 'HEAD', timeoutMs = 6000, redirectsLeft = MAX_REDIRECTS): Promise<{ status: number; url: string; body: string } | null> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (isBlockedHost(hostname)) {
    return null;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };

  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual'
    });

    // Real (non-mocked) 3xx: validate the target host before ever fetching it.
    if (res.status >= 300 && res.status < 400 && typeof (res as any).headers?.get === 'function') {
      const location = (res as any).headers.get('location');
      if (!location || redirectsLeft <= 0) return null;
      let nextUrl: string;
      try {
        nextUrl = new URL(location, url).toString();
      } catch {
        return null;
      }
      return fetchHelper(nextUrl, method, timeoutMs, redirectsLeft - 1);
    }

    let body = '';
    if (method === 'GET' && res.status === 200) {
      body = await res.text();
    }
    return {
      status: res.status,
      url: res.url || url,
      body
    };
  } catch {
    return null;
  }
}

export async function probeArtist(artist: { name: string; website: string }): Promise<{ tourUrl: string | null; pathPattern: string | null; reason: string }> {
  const website = artist.website;
  if (!website) {
    return { tourUrl: null, pathPattern: null, reason: 'No website' };
  }

  let baseHostname = '';
  let preFlightUrl = '';
  try {
    preFlightUrl = website.trim().startsWith('http') ? website.trim() : 'https://' + website.trim();
    baseHostname = new URL(preFlightUrl).hostname;
  } catch {
    return { tourUrl: null, pathPattern: null, reason: 'Invalid website URL' };
  }

  if (isBlockedHost(baseHostname)) {
    return { tourUrl: null, pathPattern: null, reason: 'Blocked host (SSRF guard)' };
  }

  // Pre-flight check: ensure the site is actually online before probing 18 suffixes
  const preFlight = await fetchHelper(preFlightUrl, 'HEAD', 5000) || await fetchHelper(preFlightUrl, 'GET', 5000);
  if (!preFlight) {
    return { tourUrl: null, pathPattern: null, reason: 'Base website offline or DNS resolution failed' };
  }

  for (const suffix of SUFFIXES) {
    const probeUrl = buildProbeUrl(website, suffix);
    let hostname = '';
    try {
      hostname = new URL(probeUrl).hostname;
    } catch {
      continue;
    }

    if (isBlockedHost(hostname)) {
      continue;
    }

    let res = await fetchHelper(probeUrl, 'HEAD');
    if (!res || res.status >= 400) {
      if (res && res.status === 404) {
        continue;
      }
      res = await fetchHelper(probeUrl, 'GET');
    } else {
      res = await fetchHelper(probeUrl, 'GET');
    }

    if (!res || res.status !== 200) {
      continue;
    }

    const finalUrl = res.url;

    if (!isSameOrSubdomain(website, finalUrl)) {
      continue;
    }

    // Platform domain apex redirect guard (prevents subdomains on e.g. bandcamp/myspace from redirecting to parent domain)
    try {
      const origUrlObj = new URL(website.trim().startsWith('http') ? website.trim() : 'https://' + website.trim());
      const finalUrlObj = new URL(finalUrl);
      const origHost = origUrlObj.hostname.toLowerCase().replace(/^www\./, '');
      const finalHost = finalUrlObj.hostname.toLowerCase().replace(/^www\./, '');
      
      const PLATFORM_DOMAINS = new Set([
        'bandcamp.com', 'facebook.com', 'youtube.com', 'instagram.com', 'twitter.com',
        'x.com', 'myspace.com', 'soundcloud.com', 'linktr.ee', 'github.io', 'wordpress.com',
        'tumblr.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'tiktok.com', 'vimeo.com',
        'pinterest.com', 'linkedin.com', 'songkick.com', 'bandsintown.com'
      ]);
      
      if (PLATFORM_DOMAINS.has(finalHost) && origHost !== finalHost) {
        continue;
      }
    } catch {}

    // Resolved path block keywords guard (prevents matching album/store/sponsorship/privacy policy subpages)
    try {
      const finalPath = new URL(finalUrl).pathname.toLowerCase();
      const PATH_BLOCK_KEYWORDS = [
        '/album', '/release', '/shop', '/store', '/product', '/bio', '/about',
        '/contact', '/discography', '/sponsor', '/donate', '/support', '/advertise',
        '/privacy', '/terms'
      ];
      if (PATH_BLOCK_KEYWORDS.some(kw => finalPath.includes(kw))) {
        continue;
      }
    } catch {}

    if (isHomepageOrSamePath(website, finalUrl)) {
      continue;
    }

    if (!hasMeaningfulPathKeyword(finalUrl)) {
      continue;
    }

    const analysis = analyzeContent(res.body);
    if (analysis.ok) {
      return {
        tourUrl: finalUrl,
        pathPattern: suffix,
        reason: analysis.reason
      };
    }
  }

  return { tourUrl: null, pathPattern: null, reason: 'No suffix matched content requirements' };
}

async function probeBatch(batch: { name: string; website: string }[], concurrency = 10): Promise<any[]> {
  const results: any[] = [];
  for (let i = 0; i < batch.length; i += concurrency) {
    const slice = batch.slice(i, i + concurrency);
    const sliceResults = await Promise.all(
      slice.map(async (candidate) => {
        const hit = await probeArtist(candidate);
        await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 50)); // Jitter
        return {
          name: candidate.name,
          website: candidate.website,
          ...hit
        };
      })
    );
    results.push(...sliceResults);
    console.log(`[discover-tour-urls] Probed batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(batch.length / concurrency)}...`);
  }
  return results;
}

async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
}

async function appendToAuditFile(filePath: string, newHits: any[]): Promise<void> {
  if (newHits.length === 0) return;
  let hits: any[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    hits = JSON.parse(content);
    if (!Array.isArray(hits)) hits = [];
  } catch {}
  hits.push(...newHits);
  await fs.writeFile(filePath, JSON.stringify(hits, null, 2), 'utf-8');
}

async function select(n: number, outFile?: string): Promise<void> {
  const artists = await loadDb();
  const pending: { name: string; website: string }[] = [];
  for (const a of artists) {
    if (a.website && !a.tourUrl && !a.tourUrlProbeTriedAt) {
      pending.push({ name: a.name, website: a.website });
      if (pending.length >= n) break;
    }
  }
  const json = JSON.stringify(pending, null, 2);
  if (outFile) {
    await fs.writeFile(outFile, json, 'utf-8');
    console.error(`[discover-tour-urls] Wrote ${pending.length} pending candidates to ${outFile}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

async function probe(candidatesFile: string, resultsFile: string): Promise<void> {
  const content = await fs.readFile(candidatesFile, 'utf-8');
  const candidates: { name: string; website: string }[] = JSON.parse(content);
  
  if (!Array.isArray(candidates)) {
    throw new Error('Candidates file must contain a JSON array of objects');
  }
  
  console.log(`[discover-tour-urls] Probing ${candidates.length} candidates...`);
  const results = await probeBatch(candidates, 10);
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`[discover-tour-urls] Probed all candidates and wrote results to ${resultsFile}`);
}

async function apply(resultsFile: string): Promise<void> {
  const artists = await loadDb();
  const results: ProbeResult[] = JSON.parse(await fs.readFile(resultsFile, 'utf-8'));
  
  const byName = new Map<string, number>();
  artists.forEach((a, i) => byName.set(a.name.toLowerCase(), i));
  
  const now = new Date().toISOString();
  let hitsCount = 0;
  let missesCount = 0;
  const unmatched: string[] = [];
  const auditHits: any[] = [];
  
  for (const r of results) {
    const idx = byName.get(r.name.toLowerCase());
    if (idx === undefined) {
      unmatched.push(r.name);
      continue;
    }
    
    const entry = artists[idx];
    entry.tourUrlProbeTriedAt = now;
    
    if (r.tourUrl) {
      entry.tourUrl = r.tourUrl;
      hitsCount++;
      auditHits.push({
        artist: entry.name,
        website: entry.website,
        tourUrl: r.tourUrl,
        pathPattern: r.pathPattern,
        reason: r.reason,
        appliedAt: now
      });
    } else {
      missesCount++;
    }
  }
  
  await saveDb(artists);
  
  const auditPath = path.join(process.cwd(), 'data', 'tour-url-probe-hits.json');
  await appendToAuditFile(auditPath, auditHits);
  
  console.log(`[discover-tour-urls] apply complete:`);
  console.log(`  candidates processed : ${results.length}`);
  console.log(`  hits (tourUrls found): ${hitsCount}`);
  console.log(`  misses               : ${missesCount}`);
  if (unmatched.length) {
    console.log(`  unmatched (not in DB): ${unmatched.length} -> ${unmatched.slice(0, 10).join(', ')}`);
  }
  if (auditHits.length) {
    console.log(`  Audit log appended at ${auditPath}`);
  }
}

async function stats(): Promise<void> {
  const artists = await loadDb();
  const total = artists.length;
  const withWebsite = artists.filter(a => a.website).length;
  const withTourUrl = artists.filter(a => a.tourUrl).length;
  const tried = artists.filter(a => a.tourUrlProbeTriedAt).length;
  const hits = artists.filter(a => a.tourUrl && a.tourUrlProbeTriedAt).length;
  const misses = artists.filter(a => !a.tourUrl && a.tourUrlProbeTriedAt).length;
  
  console.log(`[discover-tour-urls] Stats:`);
  console.log(`  total artists       : ${total}`);
  console.log(`  with website        : ${withWebsite}`);
  console.log(`  with tourUrl        : ${withTourUrl}`);
  console.log(`  probed (tried)      : ${tried}`);
  console.log(`    hits              : ${hits}`);
  console.log(`    misses            : ${misses}`);
  console.log(`  eligible remaining  : ${artists.filter(a => a.website && !a.tourUrl && !a.tourUrlProbeTriedAt).length}`);
}

async function runConvenience(n: number): Promise<void> {
  const artists = await loadDb();
  const pending: { name: string; website: string }[] = [];
  for (const a of artists) {
    if (a.website && !a.tourUrl && !a.tourUrlProbeTriedAt) {
      pending.push({ name: a.name, website: a.website });
      if (pending.length >= n) break;
    }
  }
  
  if (pending.length === 0) {
    console.log('[discover-tour-urls] No pending candidates found.');
    return;
  }
  
  console.log(`[discover-tour-urls] Running probe on ${pending.length} candidates in single-pass mode...`);
  const results = await probeBatch(pending, 10);
  
  const now = new Date().toISOString();
  let hitsCount = 0;
  let missesCount = 0;
  const auditHits: any[] = [];
  
  const freshArtists = await loadDb();
  const byName = new Map<string, number>();
  freshArtists.forEach((a, i) => byName.set(a.name.toLowerCase(), i));
  
  for (const r of results) {
    const idx = byName.get(r.name.toLowerCase());
    if (idx === undefined) continue;
    
    const entry = freshArtists[idx];
    entry.tourUrlProbeTriedAt = now;
    
    if (r.tourUrl) {
      entry.tourUrl = r.tourUrl;
      hitsCount++;
      auditHits.push({
        artist: entry.name,
        website: entry.website,
        tourUrl: r.tourUrl,
        pathPattern: r.pathPattern,
        reason: r.reason,
        appliedAt: now
      });
    } else {
      missesCount++;
    }
  }
  
  await saveDb(freshArtists);
  
  const auditPath = path.join(process.cwd(), 'data', 'tour-url-probe-hits.json');
  await appendToAuditFile(auditPath, auditHits);
  
  console.log(`[discover-tour-urls] run complete:`);
  console.log(`  processed            : ${results.length}`);
  console.log(`  hits (tourUrls found): ${hitsCount}`);
  console.log(`  misses               : ${missesCount}`);
  if (auditHits.length) {
    console.log(`  Audit log appended at ${auditPath}`);
  }
}

async function main() {
  const [mode, arg1, arg2] = process.argv.slice(2);
  switch (mode) {
    case 'select':
      await select(parseInt(arg1 || '50', 10), arg2);
      break;
    case 'probe':
      if (!arg1 || !arg2) throw new Error('probe requires candidatesFile and resultsFile paths');
      await probe(arg1, arg2);
      break;
    case 'apply':
      if (!arg1) throw new Error('apply requires a resultsFile path');
      await apply(arg1);
      break;
    case 'stats':
      await stats();
      break;
    case 'run':
      await runConvenience(parseInt(arg1 || '50', 10));
      break;
    default:
      console.error('Usage: discover_tour_urls.ts <select <N> [outFile] | probe <candidatesFile> <resultsFile> | apply <resultsFile> | stats | run <N>>');
      process.exit(1);
  }
}

// Check entry point
if (require.main === module || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('discover_tour_urls.ts'))) {
  main().catch((err) => {
    console.error(`[discover-tour-urls] Fatal: ${err.message}`);
    process.exit(1);
  });
}
