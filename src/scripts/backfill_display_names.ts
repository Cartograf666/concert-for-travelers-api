import axios from 'axios';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { isReadableScript, pickReadable } from '../pipeline/script.js';
import { sleep } from '../engine/sleep.js';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Gives an English name to the artists whose own name is in a script the
 * published feed's readers cannot read.
 *
 * The publish-time script filter solves the alias problem by choosing among
 * variants, but a name has no variants to choose from: `ヨルシカ` either gets an
 * English label from somewhere or it vanishes from an English-language feed
 * entirely, which is worse than showing it untranslated. So this fetches one --
 * it never deletes and never guesses.
 *
 * Two sources, cheapest first:
 *   1. The entry's own aliases, when one is already readable. Free.
 *   2. Wikidata's English rdfs:label, matched by MusicBrainz id (P434) rather
 *      than by name -- an unreadable name cannot be matched against the @en
 *      labels the bulk enricher queries, but an MBID is language-neutral and
 *      exact, so there is no ambiguity to resolve.
 *
 * Writes `displayName`. `name` is left alone because the matcher needs it: 東京事変
 * on a Japanese listing page is how that artist is recognised at all.
 *
 *   backfill-display-names           dry run -- report what it would set
 *   backfill-display-names --apply   write displayName to the artist DB
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'ConcertForTravelers/1.0 ( axell2479@gmail.com )'; // Wikidata requires an identifying UA
const BATCH = 50;

function buildQuery(mbids: string[]): string {
  const values = mbids.map((m) => `"${m.replace(/"/g, '')}"`).join(' ');
  return `SELECT ?mbid ?label WHERE {
  VALUES ?mbid { ${values} }
  ?item wdt:P434 ?mbid .
  ?item rdfs:label ?label .
  FILTER(LANG(?label) = "en")
}`;
}

async function labelsByMbid(mbids: string[]): Promise<Map<string, string>> {
  const res = await axios.get(ENDPOINT, {
    params: { query: buildQuery(mbids), format: 'json' },
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
    timeout: 60000
  });
  const out = new Map<string, string>();
  for (const b of res.data?.results?.bindings ?? []) {
    const mbid = b.mbid?.value;
    const label = b.label?.value;
    if (!mbid || !label || out.has(mbid)) continue;
    out.set(mbid, label);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const db = (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];

  const pending = db.filter((a) => !isReadableScript(a.name) && !(a as any).displayName);
  if (pending.length === 0) { console.log('[DisplayName] Nothing pending.'); return; }
  console.log(`[DisplayName] ${pending.length} artist(s) with an unreadable name.`);

  const resolved: Array<{ name: string; displayName: string; via: string }> = [];
  const unresolved: string[] = [];

  // 1. Free pass: a readable alias already on the entry.
  const stillPending: ArtistEntry[] = [];
  for (const a of pending) {
    const fromAlias = pickReadable(a.aliases || [], false);
    if (fromAlias) {
      if (apply) (a as any).displayName = fromAlias;
      resolved.push({ name: a.name, displayName: fromAlias, via: 'alias' });
    } else {
      stillPending.push(a);
    }
  }

  // 2. Wikidata by MBID. Artists without one are reported, not guessed at.
  const withMbid = stillPending.filter((a) => a.mbid);
  for (const a of stillPending) if (!a.mbid) unresolved.push(`${a.name} (no mbid)`);

  for (let i = 0; i < withMbid.length; i += BATCH) {
    const batch = withMbid.slice(i, i + BATCH);
    let labels: Map<string, string>;
    try {
      labels = await labelsByMbid(batch.map((a) => a.mbid!));
    } catch (err: any) {
      console.error(`[DisplayName] batch ${i / BATCH + 1} failed (${err.message}); left pending.`);
      continue;
    }
    for (const a of batch) {
      const label = labels.get(a.mbid!);
      // A Wikidata "English label" that is itself in the native script is no help;
      // that is Wikidata having no English name, not an English name we can use.
      if (!label || !isReadableScript(label)) { unresolved.push(`${a.name} (no usable en label)`); continue; }
      if (apply) (a as any).displayName = label;
      resolved.push({ name: a.name, displayName: label, via: 'wikidata' });
    }
    if (i + BATCH < withMbid.length) await sleep(1200);
  }

  for (const r of resolved) console.log(`  ${r.name}  ->  ${r.displayName}   [${r.via}]`);
  console.log(`[DisplayName] resolved ${resolved.length}, unresolved ${unresolved.length}`);
  for (const u of unresolved) console.log(`  unresolved: ${u}`);

  if (!apply) { console.log('[DisplayName] DRY RUN -- nothing written. Re-run with --apply.'); return; }
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, db);
  console.log(`[DisplayName] Wrote ${resolved.length} displayName(s).`);
}

main().catch((err) => { console.error('[DisplayName] fatal:', err); process.exitCode = 1; });
