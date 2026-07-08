import * as fs from 'fs/promises';
import * as path from 'path';
import { lastfmArtistInfo } from './enrich_metadata.js';

/**
 * Ranks candidates for a NEW dedicated tour-page scraper config
 * (scrapers/artists/*.json) by Last.fm popularity -- an objective, always-
 * fresh signal instead of relying on a hand-picked "who do users search for
 * most" list (see BACKLOG.md's Bandsintown coverage-gap plan, step 3).
 *
 * Candidate pool: artists already on our own target list
 * (data/artist_scrape_targets.txt) that don't already have a dedicated
 * scrapers/artists/*.json config and have a known official website (no URL,
 * no scraper to build). Deliberately scoped to artists we already track --
 * this is about prioritizing which of THEM deserve a more-reliable dedicated
 * scraper, not discovering new artists (that's discover_artists.ts's job).
 *
 * Ranked by Last.fm listeners: prefers the popularity already collected by
 * enrich_metadata.ts (entry.popularity.listeners, no extra API calls); for a
 * candidate missing it, queries Last.fm live for just this report (read-only,
 * NOT persisted back to approved_artists.json -- that's enrich_metadata.ts's
 * job on its own schedule). Needs LASTFM_API_KEY; without one, only
 * already-collected popularity is used and the rest are reported unranked
 * (still listed, just not confidently ordered).
 *
 * Usage: rank_scraper_candidates.ts [N]   default 20
 */

interface ArtistEntry {
  name: string;
  website: string | null;
  popularity?: { listeners: number; playcount: number };
  [key: string]: any;
}

function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

async function loadApprovedArtists(): Promise<ArtistEntry[]> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'approved_artists.json'), 'utf-8'));
}

async function loadTargetSet(): Promise<Set<string>> {
  const raw = await fs.readFile(path.join(process.cwd(), 'data', 'artist_scrape_targets.txt'), 'utf-8');
  return new Set(raw.split('\n').map((l) => normName(l)).filter(Boolean));
}

/** Artists that already have a dedicated tour-page scraper, keyed by their
 * config's fixed artist name (selectors.artistNameFallback). */
async function loadAlreadyCoveredSet(): Promise<Set<string>> {
  const dir = path.join(process.cwd(), 'scrapers', 'artists');
  const covered = new Set<string>();
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return covered; // no directory yet -> nothing covered
  }
  for (const file of files) {
    try {
      const config = JSON.parse(await fs.readFile(path.join(dir, file), 'utf-8'));
      const name = config?.selectors?.artistNameFallback;
      if (name) covered.add(normName(name));
    } catch {
      // Skip an unreadable/malformed config rather than fail the whole report.
    }
  }
  return covered;
}

export interface Candidate {
  name: string;
  website: string;
  listeners: number | null; // null = no Last.fm data available (no key, or no confident match)
}

/**
 * Pure ranking logic, separated from I/O so it's directly testable with a
 * synthetic artist list and an injected Last.fm fetch function.
 */
export async function rankCandidates(
  artists: ArtistEntry[],
  targetSet: Set<string>,
  coveredSet: Set<string>,
  lastfmKey: string | undefined,
  fetchFn: typeof fetch = fetch
): Promise<Candidate[]> {
  const pool = artists.filter((a) => {
    const key = normName(a.name);
    return targetSet.has(key) && !coveredSet.has(key) && !!a.website;
  });

  const results: Candidate[] = [];
  for (const a of pool) {
    let listeners = a.popularity?.listeners ?? null;
    if (listeners === null && lastfmKey) {
      const info = await lastfmArtistInfo(a.name, lastfmKey, fetchFn);
      if (info.ok && info.popularity) listeners = info.popularity.listeners;
      await new Promise((r) => setTimeout(r, 250)); // same polite pacing as enrich_metadata.ts
    }
    results.push({ name: a.name, website: a.website!, listeners });
  }

  // Confidently-ranked (real listener counts) first, most popular first;
  // unranked (no Last.fm data at all) after, alphabetical -- still a useful
  // fallback list, just not a confident ordering.
  return results.sort((x, y) => {
    if (x.listeners !== null && y.listeners !== null) return y.listeners - x.listeners;
    if (x.listeners !== null) return -1;
    if (y.listeners !== null) return 1;
    return x.name.localeCompare(y.name);
  });
}

async function main() {
  const n = parseInt(process.argv[2] || '20', 10);
  const lastfmKey = process.env.LASTFM_API_KEY;
  if (!lastfmKey) {
    console.warn('[RankScraperCandidates] LASTFM_API_KEY not set -- ranking only artists already enriched with popularity data (via enrich-metadata); the rest are listed unranked.');
  }

  const [artists, targetSet, coveredSet] = await Promise.all([loadApprovedArtists(), loadTargetSet(), loadAlreadyCoveredSet()]);
  console.log(`[RankScraperCandidates] ${targetSet.size} scrape targets, ${coveredSet.size} already have a dedicated tour-page scraper.`);

  const ranked = await rankCandidates(artists, targetSet, coveredSet, lastfmKey);
  const top = ranked.slice(0, n);

  console.log(`\n[RankScraperCandidates] Top ${top.length} candidates for a new scrapers/artists/*.json config (by Last.fm listeners):\n`);
  for (const c of top) {
    console.log(`  ${(c.listeners ?? '?').toString().padStart(10)}  ${c.name}  ${c.website}`);
  }
  console.log(`\n${ranked.length} total candidate(s): on the target list, has a website, no scraper yet.`);
}

// Guard so tests can import rankCandidates without triggering this file's own
// CLI run (CommonJS output -- see enrich_wikidata_bulk.ts for why require.main,
// not import.meta, is the right entrypoint check here).
if (require.main === module) {
  main().catch((err) => {
    console.error(`[RankScraperCandidates] Fatal: ${err.message}`);
    process.exit(1);
  });
}
