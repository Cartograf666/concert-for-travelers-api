import axios from 'axios';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { mergeArtistAliases, normalizeArtistName } from '../pipeline/artistAliases.js';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Fast Tier-0 accelerator: resolve MANY artists per Wikidata SPARQL query instead
 * of one REST round-trip each. A single request matches ~80 names by label/alias
 * and returns official website + social handles in one shot — hundreds of times
 * faster than the per-artist MusicBrainz path (which stays as the slow long-tail).
 *
 * Precise but recall-limited: only exact English label/alias matches on a confirmed
 * music act (P31) are trusted. Misses fall through to MusicBrainz / the Gemini tier.
 *
 * Markers:
 *   enrichedAt + enrichedBy='wikidata-bulk'  set on a hit (Gemini skips it).
 *   wdBulkTriedAt                            legacy marker, still stamped on every
 *                                            processed name for backfill_mbid.ts's
 *                                            gate, but no longer what THIS file
 *                                            selects on (see below).
 *   wdAliasesTriedAt                         the actual pending-gate now (see
 *                                            selectPendingWikidataBulkArtists).
 *                                            Deliberately a NEW marker rather than
 *                                            reusing wdBulkTriedAt: every artist
 *                                            already processed under the old
 *                                            marker has wdBulkTriedAt set but not
 *                                            this one, so gating on it forces
 *                                            exactly one more pass over the whole
 *                                            already-processed population to
 *                                            backfill aliases, then this marker
 *                                            takes over as the steady-state gate.
 *
 * Usage: enrich_wikidata_bulk.ts [N] [batchSize]   default N=5000, batch=80
 *
 * Do NOT run concurrently with enrich_auto / enrich_sites apply — single DB writer.
 */

interface Socials {
  spotify: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  telegram: string | null;
  vk: string | null;
}

const UA = 'ConcertForTravelers/1.0 ( axell2479@gmail.com )'; // Wikidata requires an identifying UA
const ENDPOINT = 'https://query.wikidata.org/sparql';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function emptySocials(): Socials {
  return { spotify: null, instagram: null, facebook: null, youtube: null, telegram: null, vk: null };
}

export const normName = normalizeArtistName;

/** Escape a value for embedding inside a SPARQL string literal. */
function sparqlLiteral(name: string): string {
  return '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\t]/g, ' ') + '"@en';
}

export function buildQuery(names: string[]): string {
  const values = names.map(sparqlLiteral).join(' ');
  return `SELECT ?name ?item ?sitelinks ?website ?spotify ?instagram ?facebook ?youtube ?vk ?telegram ?mbid ?altLabel WHERE {
  VALUES ?name { ${values} }
  { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
  ?item wdt:P31 ?type .
  ?item wikibase:sitelinks ?sitelinks .
  FILTER(?type IN (wd:Q215380, wd:Q5, wd:Q2088357, wd:Q215627))
  OPTIONAL { ?item skos:altLabel ?altLabel }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P1902 ?spotify }
  OPTIONAL { ?item wdt:P2003 ?instagram }
  OPTIONAL { ?item wdt:P2013 ?facebook }
  OPTIONAL { ?item wdt:P2397 ?youtube }
  OPTIONAL { ?item wdt:P3185 ?vk }
  OPTIONAL { ?item wdt:P3789 ?telegram }
  OPTIONAL { ?item wdt:P434 ?mbid }
}`;
}

export interface Resolved {
  item: string;
  website: string | null;
  socials: Socials;
  mbid: string | null;
  wikidataSitelinks: number | null;
  aliases?: string[];
}

/**
 * Run one SPARQL batch. Returns a map keyed by normalized name. A name that
 * resolves to more than one distinct entity is dropped as ambiguous.
 */
export async function queryBatch(names: string[]): Promise<Map<string, Resolved | 'ambiguous'>> {
  const query = buildQuery(names);
  let attempt = 0;
  let data: any;
  while (true) {
    try {
      const res = await axios.get(ENDPOINT, {
        params: { query, format: 'json' },
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        timeout: 60000
      });
      data = res.data;
      break;
    } catch (err: any) {
      const status = err.response?.status;
      const retryable = status === 429 || status === undefined || status >= 500;
      if (!retryable || attempt >= 2) throw err;
      attempt++;
      await sleep(2000 * attempt);
    }
  }

  const byName = new Map<string, Resolved | 'ambiguous'>();
  for (const b of data?.results?.bindings ?? []) {
    const nameKey = normName(b.name?.value ?? '');
    const item = b.item?.value ?? '';
    if (!nameKey || !item) continue;

    const existing = byName.get(nameKey);
    if (existing === 'ambiguous') continue;
    if (existing && existing.item !== item) {
      byName.set(nameKey, 'ambiguous');
      continue;
    }

    const r: Resolved = existing ?? { item, website: null, socials: emptySocials(), mbid: null, wikidataSitelinks: null };
    if (b.website?.value && !r.website) r.website = b.website.value;
    if (b.spotify?.value && !r.socials.spotify) r.socials.spotify = `https://open.spotify.com/artist/${b.spotify.value}`;
    if (b.instagram?.value && !r.socials.instagram) r.socials.instagram = `https://www.instagram.com/${String(b.instagram.value).replace(/^@/, '')}`;
    if (b.facebook?.value && !r.socials.facebook) r.socials.facebook = `https://www.facebook.com/${b.facebook.value}`;
    if (b.youtube?.value && !r.socials.youtube) r.socials.youtube = `https://www.youtube.com/channel/${b.youtube.value}`;
    if (b.vk?.value && !r.socials.vk) r.socials.vk = `https://vk.com/${b.vk.value}`;
    if (b.telegram?.value && !r.socials.telegram) r.socials.telegram = `https://t.me/${String(b.telegram.value).replace(/^@/, '')}`;
    if (b.mbid?.value && !r.mbid) r.mbid = b.mbid.value;
    if (b.sitelinks?.value && r.wikidataSitelinks === null) {
      const sitelinks = Number(b.sitelinks.value);
      if (Number.isFinite(sitelinks)) r.wikidataSitelinks = sitelinks;
    }
    if (b.altLabel?.value) {
      const alt = b.altLabel.value.trim();
      if (alt && normName(alt) !== nameKey) {
        if (!r.aliases) r.aliases = [];
        if (!r.aliases.includes(alt)) r.aliases.push(alt);
      }
    }
    byName.set(nameKey, r);
  }
  return byName;
}

export async function loadDb(): Promise<ArtistEntry[]> {
  return (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
}

export async function saveDb(artists: ArtistEntry[]): Promise<void> {
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, artists);
}

/**
 * Existing rows have already been through the metadata pass, so aliases use a
 * separate marker. That makes the rollout a one-time backfill without
 * re-opening the normal wdBulkTriedAt/enrichedAt work queue on later runs.
 */
export function selectPendingWikidataBulkArtists(artists: ArtistEntry[], n: number): ArtistEntry[] {
  return artists.filter((artist) => !artist.wdAliasesTriedAt).slice(0, n);
}

function hasData(website: string | null, socials: Socials, mbid: string | null, wikidataSitelinks: number | null): boolean {
  return !!website || !!mbid || wikidataSitelinks !== null || Object.values(socials).some(Boolean);
}

async function main() {
  const n = parseInt(process.argv[2] || '5000', 10);
  const batchSize = parseInt(process.argv[3] || '80', 10);
  const artists = await loadDb();

  const pending = selectPendingWikidataBulkArtists(artists, n);
  if (pending.length === 0) {
    console.log('[wd-bulk] Nothing pending for the Wikidata bulk pass.');
    return;
  }
  // Index DB rows by normalized name so a single resolution can update every duplicate.
  const rowsByName = new Map<string, ArtistEntry[]>();
  for (const a of artists) {
    const k = normName(a.name);
    (rowsByName.get(k) ?? rowsByName.set(k, []).get(k)!).push(a);
  }

  console.log(`[wd-bulk] ${pending.length} artists, batch ${batchSize} (${Math.ceil(pending.length / batchSize)} queries).`);
  const now = () => new Date().toISOString();
  let hits = 0;
  let processed = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let resolved: Map<string, Resolved | 'ambiguous'>;
    try {
      resolved = await queryBatch(batch.map((a) => a.name));
    } catch (err: any) {
      console.error(`[wd-bulk] batch ${i / batchSize + 1} failed (${err.message}); leaving these pending for retry.`);
      await sleep(1500);
      continue; // don't mark wdBulkTriedAt -> retried next run
    }

    const stamp = now();
    for (const entry of batch) {
      const key = normName(entry.name);
      const r = resolved.get(key);
      entry.wdBulkTriedAt = stamp; // processed this pass either way
      entry.wdAliasesTriedAt = stamp;
      if (r && r !== 'ambiguous') {
        const aliasesAdded = mergeArtistAliases(entry, r.aliases ?? []);
        const hasMetadata = hasData(r.website, r.socials, r.mbid, r.wikidataSitelinks);
        if (hasMetadata) {
          const merged = { ...emptySocials(), ...(entry.socials || {}) };
          for (const [k, v] of Object.entries(r.socials)) {
            const kk = k as keyof Socials;
            if (v && !merged[kk]) merged[kk] = v;
          }
          entry.website = entry.website || r.website;
          entry.socials = merged;
          entry.mbid = entry.mbid || r.mbid || undefined;
          if (r.wikidataSitelinks !== null) entry.wikidataSitelinks = r.wikidataSitelinks;
          entry.enrichedAt = stamp;
          entry.enrichedBy = entry.enrichedBy ? `${entry.enrichedBy}+wikidata-bulk` : 'wikidata-bulk';
        }
        if (hasMetadata || aliasesAdded) {
          hits++;
        }
      }
      processed++;
    }

    await saveDb(artists);
    console.log(`[wd-bulk] ...${processed}/${pending.length} (hits ${hits})`);
    await sleep(1200); // polite spacing between SPARQL queries
  }

  console.log('[wd-bulk] Done.');
  console.log(`  processed : ${processed}`);
  console.log(`  hits      : ${hits}`);
  console.log(`  misses    : ${processed - hits} (marked wdBulkTriedAt, still pending for MB/Gemini)`);
}

// Guard so backfill_mbid.ts can import this module's helpers (loadDb/saveDb/
// queryBatch/normName/sleep) for reuse without triggering this file's own CLI run.
// (CommonJS output -- no "type": "module" in package.json -- so require.main is
// the right entrypoint check, not import.meta.)
if (require.main === module) {
  main().catch((err) => {
    console.error(`[wd-bulk] Fatal: ${err.message}`);
    process.exit(1);
  });
}
