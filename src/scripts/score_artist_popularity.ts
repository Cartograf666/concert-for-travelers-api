import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { slugify } from '../pipeline/process.js';
import { ArtistEntry } from '../schemas/artist.js';

const WEIGHTS = {
  listeners: 0.4,
  playcount: 0.15,
  sitelinks: 0.25,
  similarInbound: 0.05,
  touring: 0.15
};

const PROFESSIONAL_CAP = 100000;

const ANCHOR_ARTISTS = [
  'Taylor Swift',
  'Beyoncé',
  'Drake',
  'The Weeknd',
  'Adele',
  'Coldplay',
  'Ed Sheeran',
  'Billie Eilish',
  'Ariana Grande',
  'Metallica',
  'U2',
  'Madonna',
  'Lady Gaga',
  'Rihanna',
  'Bruno Mars',
  'Eminem',
  'Radiohead',
  'Muse',
  'Red Hot Chili Peppers',
  'The Rolling Stones',
  'Paul McCartney',
  'Elton John',
  'Depeche Mode',
  'Rammstein',
  'Blackpink',
  'Bad Bunny',
  'Dua Lipa'
];

interface TouringSnapshot {
  source: string;
  countriesByArtistSlug: Map<string, Set<string>>;
}

interface ProtectedTargets {
  slugs: Set<string>;
  manualCount: number;
  dedicatedScraperCount: number;
}

export interface ArtistPopularityScore {
  artist: ArtistEntry;
  slug: string;
  score: number;
  percentile: number;
  listeners: number;
  playcount: number;
  wikidataSitelinks: number;
  similarInboundCount: number;
  sitelinksPercentile: number;
  similarInboundPercentile: number;
  touringBonus: number;
  touringCountries: number;
}

export function selectProfessionalSlugs(
  scored: Pick<ArtistPopularityScore, 'slug' | 'score'>[],
  threshold: number,
  protectedSlugs: Set<string>,
  cap = PROFESSIONAL_CAP
): Set<string> {
  const professionalSlugs = new Set<string>();
  if (cap <= 0) return professionalSlugs;

  for (const row of scored) {
    if (!protectedSlugs.has(row.slug)) continue;
    professionalSlugs.add(row.slug);
    if (professionalSlugs.size >= cap) return professionalSlugs;
  }

  for (const row of scored) {
    if (row.score < threshold) break;
    professionalSlugs.add(row.slug);
    if (professionalSlugs.size >= cap) return professionalSlugs;
  }

  return professionalSlugs;
}

function numericField(artist: ArtistEntry, key: 'wikidataSitelinks' | 'similarInboundCount'): number {
  const value = artist[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function percentileRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  const rankByValue = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i];
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === value) j++;
    rankByValue.set(value, i / (sorted.length - 1));
    i = j;
  }
  return values.map((v) => rankByValue.get(v) ?? 0);
}

function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function touringBonus(countries: number): number {
  if (countries <= 0) return 0;
  return countries >= 2 ? 1 : 0.67;
}

export function scoreArtists(artists: ArtistEntry[], touring: TouringSnapshot): ArtistPopularityScore[] {
  const sitelinkRanks = percentileRanks(artists.map((a) => numericField(a, 'wikidataSitelinks')));
  const inboundRanks = percentileRanks(artists.map((a) => numericField(a, 'similarInboundCount')));

  const scored = artists.map((artist, i) => {
    const listeners = artist.popularity?.listeners ?? 0;
    const playcount = artist.popularity?.playcount ?? 0;
    const wikidataSitelinks = numericField(artist, 'wikidataSitelinks');
    const similarInboundCount = numericField(artist, 'similarInboundCount');
    const slug = slugify(artist.name);
    const touringCountries = touring.countriesByArtistSlug.get(slug)?.size ?? 0;
    const bonus = touringBonus(touringCountries);
    const score =
      WEIGHTS.listeners * Math.log1p(listeners) +
      WEIGHTS.playcount * Math.log1p(playcount) +
      WEIGHTS.sitelinks * sitelinkRanks[i] +
      WEIGHTS.similarInbound * inboundRanks[i] +
      WEIGHTS.touring * bonus;
    return {
      artist,
      slug,
      score,
      percentile: 0,
      listeners,
      playcount,
      wikidataSitelinks,
      similarInboundCount,
      sitelinksPercentile: sitelinkRanks[i],
      similarInboundPercentile: inboundRanks[i],
      touringBonus: bonus,
      touringCountries
    };
  });

  const scoreRanks = percentileRanks(scored.map((s) => s.score));
  scored.forEach((s, i) => {
    s.percentile = scoreRanks[i];
  });
  return scored.sort((a, b) => b.score - a.score || a.artist.name.localeCompare(b.artist.name));
}

async function loadTouringSnapshot(): Promise<TouringSnapshot> {
  const concertsPath = path.join(process.cwd(), 'dist', 'concerts.json');
  const countriesByArtistSlug = new Map<string, Set<string>>();
  try {
    const concerts = JSON.parse(await fs.readFile(concertsPath, 'utf-8'));
    for (const concert of Array.isArray(concerts) ? concerts : []) {
      if (!concert?.artist) continue;
      const slug = slugify(concert.artist);
      const countries = countriesByArtistSlug.get(slug) ?? new Set<string>();
      if (typeof concert.country === 'string' && concert.country) countries.add(concert.country.toUpperCase());
      countriesByArtistSlug.set(slug, countries);
    }
    return { source: concertsPath, countriesByArtistSlug };
  } catch {
    return {
      source: 'none: dist/concerts.json not found/readable; touringBonus treated as 0 for this analysis',
      countriesByArtistSlug
    };
  }
}

async function loadProtectedTargets(): Promise<ProtectedTargets> {
  const slugs = new Set<string>();
  let manualCount = 0;
  let dedicatedScraperCount = 0;

  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'data', 'artist_scrape_targets.txt'), 'utf-8');
    for (const line of raw.split('\n')) {
      const name = line.trim();
      if (!name) continue;
      slugs.add(slugify(name));
      manualCount++;
    }
  } catch {
    // Missing target file is fine for local/test runs.
  }

  const scraperDir = path.join(process.cwd(), 'scrapers', 'artists');
  try {
    const files = (await fs.readdir(scraperDir)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const config = JSON.parse(await fs.readFile(path.join(scraperDir, file), 'utf-8'));
        const name = config?.selectors?.artistNameFallback;
        if (!name) continue;
        slugs.add(slugify(name));
        dedicatedScraperCount++;
      } catch {
        // Skip malformed configs; loadConfigs reports them in the scraper job.
      }
    }
  } catch {
    // No dedicated artist scraper directory yet.
  }

  return { slugs, manualCount, dedicatedScraperCount };
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = (sortedAscending.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAscending[lo];
  return sortedAscending[lo] + (sortedAscending[hi] - sortedAscending[lo]) * (idx - lo);
}

function histogram(scored: ArtistPopularityScore[], buckets = 12): string[] {
  if (scored.length === 0) return [];
  const scores = scored.map((s) => s.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const width = (max - min) / buckets || 1;
  const counts = Array.from({ length: buckets }, () => 0);
  for (const score of scores) {
    const idx = Math.min(buckets - 1, Math.floor((score - min) / width));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  return counts.map((count, i) => {
    const from = min + width * i;
    const to = i === buckets - 1 ? max : min + width * (i + 1);
    const bar = '#'.repeat(Math.max(1, Math.round((count / maxCount) * 40)));
    return `  ${from.toFixed(2).padStart(6)}-${to.toFixed(2).padStart(6)}  ${count.toString().padStart(6)}  ${bar}`;
  });
}

function kneePoint(scored: ArtistPopularityScore[]): ArtistPopularityScore | null {
  if (scored.length < 3) return null;
  const xs = scored.map((_, i) => i / (scored.length - 1));
  const maxScore = scored[0].score;
  const minScore = scored[scored.length - 1].score;
  const ys = scored.map((s) => (maxScore === minScore ? 0 : (s.score - minScore) / (maxScore - minScore)));
  let bestIdx = 0;
  let bestDistance = -Infinity;
  for (let i = 0; i < scored.length; i++) {
    const lineY = 1 - xs[i];
    const distance = Math.abs(ys[i] - lineY);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return scored[bestIdx];
}

function printDistribution(scored: ArtistPopularityScore[], touring: TouringSnapshot): void {
  const ascending = scored.map((s) => s.score).sort((a, b) => a - b);
  console.log(`[PopularityScore] Artists scored: ${scored.length}`);
  console.log(`[PopularityScore] Weights: listeners=${WEIGHTS.listeners}, playcount=${WEIGHTS.playcount}, wikidataSitelinks=${WEIGHTS.sitelinks}, similarInboundCount=${WEIGHTS.similarInbound}, touringBonus=${WEIGHTS.touring}`);
  console.log(`[PopularityScore] Touring signal: ${touring.source}`);
  console.log('');
  console.log('[PopularityScore] Distribution:');
  for (const [label, p] of [['p50', 0.5], ['p75', 0.75], ['p90', 0.9], ['p95', 0.95], ['p99', 0.99]] as const) {
    console.log(`  ${label}: ${percentile(ascending, p).toFixed(4)}`);
  }
  const knee = kneePoint(scored);
  if (knee) {
    console.log(`  knee: score ${knee.score.toFixed(4)} around percentile ${(knee.percentile * 100).toFixed(2)} (${knee.artist.name})`);
  }
  console.log('');
  console.log('[PopularityScore] Histogram:');
  for (const line of histogram(scored)) console.log(line);
}

function printTop(scored: ArtistPopularityScore[], n = 25): void {
  console.log('');
  console.log(`[PopularityScore] Top ${n}:`);
  for (const row of scored.slice(0, n)) {
    console.log(
      `  ${row.score.toFixed(4).padStart(8)}  p${(row.percentile * 100).toFixed(2).padStart(6)}  ` +
      `${row.artist.name}  listeners=${row.listeners} playcount=${row.playcount} ` +
      `sitelinks=${row.wikidataSitelinks} inbound=${row.similarInboundCount} countries=${row.touringCountries}`
    );
  }
}

function printAnchors(scored: ArtistPopularityScore[]): void {
  const byName = new Map(scored.map((s) => [normName(s.artist.name), s]));
  console.log('');
  console.log('[PopularityScore] Calibration anchors:');
  for (const name of ANCHOR_ARTISTS) {
    const row = byName.get(normName(name));
    if (!row) {
      console.log(`  MISSING  ${name}`);
      continue;
    }
    console.log(
      `  p${(row.percentile * 100).toFixed(2).padStart(6)}  score=${row.score.toFixed(4).padStart(8)}  ` +
      `${row.artist.name}  listeners=${row.listeners} playcount=${row.playcount} ` +
      `sitelinks=${row.wikidataSitelinks}(${(row.sitelinksPercentile * 100).toFixed(1)}p) ` +
      `inbound=${row.similarInboundCount}(${(row.similarInboundPercentile * 100).toFixed(1)}p) ` +
      `touringBonus=${row.touringBonus.toFixed(2)} countries=${row.touringCountries}`
    );
  }
}

async function analyze(): Promise<void> {
  const [artists, touring] = await Promise.all([
    loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR) as Promise<ArtistEntry[]>,
    loadTouringSnapshot()
  ]);
  const scored = scoreArtists(artists, touring);
  printDistribution(scored, touring);
  printTop(scored);
  printAnchors(scored);
}

async function applyTier(thresholdRaw: string | undefined): Promise<void> {
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold)) {
    console.error('[PopularityScore] Usage: score_artist_popularity.ts apply <threshold>');
    process.exitCode = 1;
    return;
  }

  const [artists, touring, protectedTargets] = await Promise.all([
    loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR) as Promise<ArtistEntry[]>,
    loadTouringSnapshot(),
    loadProtectedTargets()
  ]);
  const scored = scoreArtists(artists, touring);
  const professionalSlugs = selectProfessionalSlugs(scored, threshold, protectedTargets.slugs);

  let professional = 0;
  let longtail = 0;
  for (const artist of artists) {
    if (professionalSlugs.has(slugify(artist.name))) {
      artist.tier = 'professional';
      professional++;
    } else {
      artist.tier = 'longtail';
      longtail++;
    }
  }

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
  const effectiveCutoff = scored[Math.max(0, professional - 1)]?.score ?? threshold;
  console.log(`[PopularityScore] Applied tier with requested threshold ${threshold}.`);
  console.log(`[PopularityScore] professional=${professional}, longtail=${longtail}, effectiveCutoff=${effectiveCutoff.toFixed(4)}, cap=${PROFESSIONAL_CAP}.`);
  console.log(
    `[PopularityScore] Protected explicit targets: manual=${protectedTargets.manualCount}, ` +
    `dedicatedScrapers=${protectedTargets.dedicatedScraperCount}, uniqueProtected=${protectedTargets.slugs.size}.`
  );
  if (protectedTargets.slugs.size > PROFESSIONAL_CAP) {
    console.warn(`[PopularityScore] Protected targets exceed cap; only the top ${PROFESSIONAL_CAP} protected/scored rows were kept professional.`);
  }
}

async function main() {
  const [cmd, threshold] = process.argv.slice(2);
  if (!cmd || cmd === 'analyze') {
    await analyze();
    return;
  }
  if (cmd === 'apply') {
    await applyTier(threshold);
    return;
  }
  console.error('[PopularityScore] Usage: score_artist_popularity.ts analyze | apply <threshold>');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[PopularityScore] Fatal: ${err.message}`);
    process.exit(1);
  });
}
