import * as fs from 'fs/promises';
import * as path from 'path';
import { slugify } from '../pipeline/process.js';
import { ScraperConfigSchema } from '../schemas/config.js';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { ArtistEntry, ArtistSocials } from '../schemas/artist.js';

/**
 * Resumable artist-site enrichment harness.
 *
 * The heavy lifting (finding each artist's official website, tour/dates page and
 * social profiles) is done by a swarm of research agents driven from the Workflow
 * tool. This script is the deterministic, single-threaded bookend around that swarm:
 *
 *   select <N> [outFile]   Print the next N un-enriched artist names (marker: `enrichedAt`).
 *   apply <resultsFile>    Merge the swarm's structured results back into the DB atomically
 *                          and emit per-artist scraper configs for parseable tour pages.
 *   stats                  Report progress across the whole 62k catalog.
 *
 * Keeping writes here (never in the agents) means the sharded artist DB (data/artists/)
 * is only ever mutated by one process, so concurrent agents can never corrupt it.
 */

/** One artist as produced by a research agent. */
interface EnrichmentResult {
  name: string;
  website?: string | null;
  tourUrl?: string | null;
  socials?: ArtistSocials | null;
  scraper?: unknown; // best-effort ScraperConfig for the tour page; validated before writing
}

const SCRAPERS_DIR = path.join(process.cwd(), 'scrapers');

async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
}

/** Recursively drop null/undefined/empty-string leaves (keeps required "" fallbacks via caller intent). */
function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter(v => v !== null && v !== undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

function normalizeSocials(s?: ArtistSocials | null): ArtistSocials {
  return {
    spotify: s?.spotify || null,
    instagram: s?.instagram || null,
    facebook: s?.facebook || null,
    youtube: s?.youtube || null,
    telegram: s?.telegram || null,
    vk: s?.vk || null
  };
}

/** Emit the next N artists that have never been through the swarm. */
async function select(n: number, outFile?: string): Promise<void> {
  const artists = await loadDb();
  const pending: string[] = [];
  for (const a of artists) {
    // enrichedAt: a genuine hit from ANY tier. sitesTriedAt: this tier specifically
    // already looked and found nothing -- still skip re-selecting it (no point
    // asking Gemini the same question again), but distinct from enrichedAt so a
    // clean miss here doesn't strand the artist from every OTHER enrichment tier.
    if (!a.enrichedAt && !a.sitesTriedAt) pending.push(a.name);
    if (pending.length >= n) break;
  }
  const json = JSON.stringify(pending, null, 2);
  if (outFile) {
    await fs.writeFile(outFile, json, 'utf-8');
    console.error(`[enrich-sites] Wrote ${pending.length} pending artist names to ${outFile}`);
  } else {
    process.stdout.write(json + '\n');
  }
}

/** Merge swarm results into the DB and write scraper configs for parseable tour pages. */
async function apply(resultsFile: string): Promise<void> {
  const artists = await loadDb();
  const results: EnrichmentResult[] = JSON.parse(await fs.readFile(resultsFile, 'utf-8'));
  const byName = new Map<string, number>();
  artists.forEach((a, i) => byName.set(a.name.toLowerCase(), i));

  await fs.mkdir(SCRAPERS_DIR, { recursive: true });
  const now = new Date().toISOString();

  let enriched = 0;
  let websitesFound = 0;
  let toursFound = 0;
  let configsWritten = 0;
  const unmatched: string[] = [];

  for (const r of results) {
    if (!r || !r.name) continue;
    const idx = byName.get(r.name.toLowerCase());
    if (idx === undefined) {
      unmatched.push(r.name);
      continue;
    }
    const entry = artists[idx];
    const website = r.website || entry.website || null;
    const tourUrl = r.tourUrl || entry.tourUrl || null;
    const socials = normalizeSocials(r.socials ?? entry.socials);
    // A genuine hit needs website/tourUrl, or a social that wasn't already there --
    // NOT just "the agent responded" (every result gets sitesTriedAt regardless).
    // Setting enrichedAt on a confident-but-empty response would strand the artist
    // from every other enrichment tier forever (enrichedAt is the cross-tier marker
    // every tier's `pending` filter checks), with no way to retry as a better model,
    // a newly-added Wikidata page, or a future MusicBrainz entry comes online.
    const foundSomethingNew = Boolean(website) || Boolean(tourUrl)
      || Object.entries(socials).some(([k, v]) => v && !(entry.socials as any)?.[k]);
    artists[idx] = {
      ...entry,
      website,
      tourUrl,
      socials,
      sitesTriedAt: now,
      ...(foundSomethingNew ? { enrichedAt: now } : {})
    };
    if (foundSomethingNew) enriched++;
    if (website) websitesFound++;
    if (tourUrl) toursFound++;

    // Best-effort scraper config for the tour page. Runtime selector correctness is
    // later checked by `npm run scrape`; broken ones are fixed by the self-healing flow.
    if (r.scraper) {
      const slug = slugify(r.name);
      // Agents emit null for absent optional selectors; Zod's optional strings reject null,
      // so drop null/empty leaves before validating.
      const candidate = stripNulls({
        id: `artist-${slug}`,
        ...(r.scraper as Record<string, unknown>)
      });
      const parsed = ScraperConfigSchema.safeParse(candidate);
      if (parsed.success) {
        await fs.writeFile(
          path.join(SCRAPERS_DIR, `artist-${slug}.json`),
          JSON.stringify(parsed.data, null, 2),
          'utf-8'
        );
        configsWritten++;
      } else {
        console.error(`[enrich-sites] Skipped invalid scraper config for "${r.name}": ${parsed.error.issues.map(i => i.message).join('; ')}`);
      }
    }
  }

  await saveDb(artists);

  console.error(`[enrich-sites] apply complete:`);
  console.error(`  artists marked enriched : ${enriched}`);
  console.error(`  websites found          : ${websitesFound}`);
  console.error(`  tour pages found        : ${toursFound}`);
  console.error(`  scraper configs written : ${configsWritten}`);
  if (unmatched.length) {
    console.error(`  unmatched (not in DB)   : ${unmatched.length} -> ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '…' : ''}`);
  }
}

async function stats(): Promise<void> {
  const artists = await loadDb();
  const total = artists.length;
  const enriched = artists.filter(a => a.enrichedAt).length;
  const websites = artists.filter(a => a.website).length;
  const tours = artists.filter(a => a.tourUrl).length;
  // Matches select()'s actual pending filter: a clean miss (sitesTriedAt, no
  // enrichedAt) isn't "enriched" but also isn't re-selectable by this tier.
  const pending = artists.filter(a => !a.enrichedAt && !a.sitesTriedAt).length;
  const cleanMisses = artists.filter(a => a.sitesTriedAt && !a.enrichedAt).length;
  const pct = ((enriched / total) * 100).toFixed(2);
  console.log(`[enrich-sites] catalog progress`);
  console.log(`  total artists : ${total}`);
  console.log(`  enriched      : ${enriched} (${pct}%)`);
  console.log(`  with website  : ${websites}`);
  console.log(`  with tourUrl  : ${tours}`);
  console.log(`  tried, no hit : ${cleanMisses} (sitesTriedAt set, not re-selected, still eligible for other tiers)`);
  console.log(`  remaining     : ${pending}`);
}

async function main() {
  const [mode, arg1, arg2] = process.argv.slice(2);
  switch (mode) {
    case 'select':
      await select(parseInt(arg1 || '50', 10), arg2);
      break;
    case 'apply':
      if (!arg1) throw new Error('apply requires a results file path');
      await apply(arg1);
      break;
    case 'stats':
      await stats();
      break;
    default:
      console.error('Usage: enrich_sites.ts <select <N> [outFile] | apply <resultsFile> | stats>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[enrich-sites] Fatal: ${err.message}`);
  process.exit(1);
});
