import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

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
 *   wdBulkTriedAt                            set on every processed name so this
 *                                            pass never re-queries the same misses,
 *                                            yet they stay pending (!enrichedAt).
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

interface ArtistEntry {
  name: string;
  website: string | null;
  tourUrl?: string | null;
  socials?: Socials;
  enrichedAt?: string;
  enrichedBy?: string;
  autoTriedAt?: string;
  wdBulkTriedAt?: string;
}

const DB_PATH = path.join(process.cwd(), 'data', 'approved_artists.json');
const TMP_PATH = DB_PATH + '.tmp';
const UA = 'ConcertForTravelers/1.0 ( axell2479@gmail.com )'; // Wikidata requires an identifying UA
const ENDPOINT = 'https://query.wikidata.org/sparql';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptySocials(): Socials {
  return { spotify: null, instagram: null, facebook: null, youtube: null, telegram: null, vk: null };
}

function normName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Escape a value for embedding inside a SPARQL string literal. */
function sparqlLiteral(name: string): string {
  return '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\t]/g, ' ') + '"@en';
}

function buildQuery(names: string[]): string {
  const values = names.map(sparqlLiteral).join(' ');
  return `SELECT ?name ?item ?website ?spotify ?instagram ?facebook ?youtube ?vk ?telegram WHERE {
  VALUES ?name { ${values} }
  { ?item rdfs:label ?name } UNION { ?item skos:altLabel ?name }
  ?item wdt:P31 ?type .
  FILTER(?type IN (wd:Q215380, wd:Q5, wd:Q2088357, wd:Q215627))
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P1902 ?spotify }
  OPTIONAL { ?item wdt:P2003 ?instagram }
  OPTIONAL { ?item wdt:P2013 ?facebook }
  OPTIONAL { ?item wdt:P2397 ?youtube }
  OPTIONAL { ?item wdt:P3185 ?vk }
  OPTIONAL { ?item wdt:P3789 ?telegram }
}`;
}

interface Resolved {
  item: string;
  website: string | null;
  socials: Socials;
}

/**
 * Run one SPARQL batch. Returns a map keyed by normalized name. A name that
 * resolves to more than one distinct entity is dropped as ambiguous.
 */
async function queryBatch(names: string[]): Promise<Map<string, Resolved | 'ambiguous'>> {
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

    const r: Resolved = existing ?? { item, website: null, socials: emptySocials() };
    if (b.website?.value && !r.website) r.website = b.website.value;
    if (b.spotify?.value && !r.socials.spotify) r.socials.spotify = `https://open.spotify.com/artist/${b.spotify.value}`;
    if (b.instagram?.value && !r.socials.instagram) r.socials.instagram = `https://www.instagram.com/${String(b.instagram.value).replace(/^@/, '')}`;
    if (b.facebook?.value && !r.socials.facebook) r.socials.facebook = `https://www.facebook.com/${b.facebook.value}`;
    if (b.youtube?.value && !r.socials.youtube) r.socials.youtube = `https://www.youtube.com/channel/${b.youtube.value}`;
    if (b.vk?.value && !r.socials.vk) r.socials.vk = `https://vk.com/${b.vk.value}`;
    if (b.telegram?.value && !r.socials.telegram) r.socials.telegram = `https://t.me/${String(b.telegram.value).replace(/^@/, '')}`;
    byName.set(nameKey, r);
  }
  return byName;
}

async function loadDb(): Promise<ArtistEntry[]> {
  return JSON.parse(await fs.readFile(DB_PATH, 'utf-8'));
}

async function saveDb(artists: ArtistEntry[]): Promise<void> {
  artists.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(TMP_PATH, JSON.stringify(artists, null, 2), 'utf-8');
  await fs.rename(TMP_PATH, DB_PATH);
}

function hasData(website: string | null, socials: Socials): boolean {
  return !!website || Object.values(socials).some(Boolean);
}

async function main() {
  const n = parseInt(process.argv[2] || '5000', 10);
  const batchSize = parseInt(process.argv[3] || '80', 10);
  const artists = await loadDb();

  const pending = artists.filter((a) => !a.enrichedAt && !a.wdBulkTriedAt).slice(0, n);
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
      if (r && r !== 'ambiguous' && hasData(r.website, r.socials)) {
        const merged = { ...emptySocials(), ...(entry.socials || {}) };
        for (const [k, v] of Object.entries(r.socials)) {
          const kk = k as keyof Socials;
          if (v && !merged[kk]) merged[kk] = v;
        }
        entry.website = entry.website || r.website;
        entry.socials = merged;
        entry.enrichedAt = stamp;
        entry.enrichedBy = entry.enrichedBy ? `${entry.enrichedBy}+wikidata-bulk` : 'wikidata-bulk';
        hits++;
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

main().catch((err) => {
  console.error(`[wd-bulk] Fatal: ${err.message}`);
  process.exit(1);
});
