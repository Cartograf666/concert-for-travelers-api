import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import type { ArtistEntry } from '../schemas/artist.js';

// Finite, offline migration. Primary evidence and deliberately unresolved names:
// docs/ru-artist-identities-20261016.md. No discovery, fuzzy replacement or network.
const additions: ArtistEntry[] = [
  { name: 'ДДТ', mbid: 'f7456b5b-e5a5-454e-b5db-047308210c8e', website: 'https://ddt.ru/', aliases: ['DDT'] },
  { name: 'Нервы', mbid: 'd620cf32-e240-46a4-a078-db87acb5ffa0', website: null, aliases: ['Nervy', 'Нерви'] },
  { name: 'Oxxxymiron', mbid: 'fb2a8279-79cf-4849-b692-1ce674709159', website: 'https://oxxxymiron.com/', aliases: ['Оксимирон'] },
  { name: 'Монеточка', mbid: '30fcffbe-1083-4e3e-b85a-9b184b97d09f', website: 'https://monetochka.world/', aliases: ['Monetochka'] },
  { name: 'Little Big', mbid: 'cbe51088-e4d8-463e-9f4e-e83fa64d3f5e', website: 'https://littlebig.band/' },
  { name: 'Макс Корж', mbid: '38cfabf6-080c-499d-b8e8-b48aa60b7237', website: 'https://maxkorzh.com/', aliases: ['Max Korzh', 'Maks Korzh'] },
  { name: 'Zivert', mbid: '225712aa-699f-4e77-8547-93dfcdfa5666', website: 'https://zivert.com', aliases: ['Зиверт'] },
  { name: 'Баста', mbid: 'dc453ee9-f2d4-4582-840b-b3be6c79654d', website: 'https://bastatickets.ru/', aliases: ['Basta'] },
  // No Latin Kino/Dora/Morgenstern aliases: each has an existing foreign namesake.
  { name: 'Кино', mbid: '064db6e8-fdfb-4acb-a327-fc2de75b37de', website: 'https://kino.band/', aliases: ['Группа Кино', 'Gruppa Kino'] },
  { name: 'Дора', mbid: 'd87c14ef-f570-470d-be76-3e2023fa4f61', website: null },
  { name: 'MORGENSHTERN', mbid: 'ae97ba5f-e7ed-4ed5-9a53-eba415fc49d4', website: 'https://morgenshtern.love/', aliases: ['Моргенштерн'],
    socials: {
      spotify: 'https://open.spotify.com/artist/50J688nE59Wb3G1tK1aWjM',
      instagram: 'https://www.instagram.com/morgen_shtern/',
      youtube: 'https://www.youtube.com/c/MORGENSHTERN',
      telegram: 'https://t.me/morgenshtern', vk: 'https://vk.com/morgenshtern',
    } },
];
const removedNames = ['Zemfira', 'Lyapis Trubetskoy', '♫Ляпис Трубецкой', 'Мумий троль'];
const editedNames = ['Би-2', 'Сплин', 'Ляпис Трубецкой', 'Мумий Тролль', 'Земфира', 'Doro Pesch', 'Morgenstern'];
const ownedNames = new Set([...additions.map(a => a.name), ...removedNames, ...editedNames]);

export const RU_EXPLICIT_TARGETS = [...additions.map(a => a.name), 'Би-2', 'Сплин', 'Ляпис Трубецкой', 'Мумий Тролль', 'Земфира', 'Noize MC', 'Lumen'];

function addAliases(row: ArtistEntry, aliases: string[]): void {
  row.aliases = [...new Set([...(row.aliases ?? []), ...aliases])].filter(a => a !== row.name);
}

function withMbid(row: ArtistEntry, mbid: string): void {
  assert.ok(!row.mbid || row.mbid === mbid, `Unexpected MBID for ${row.name}: ${row.mbid}`);
  row.mbid = mbid;
}

/** Returns a new DB and refuses to touch any unowned row. Safe to run twice. */
export function repairRuArtistIdentities(before: ArtistEntry[]): ArtistEntry[] {
  const after = structuredClone(before);
  const get = (name: string) => {
    const rows = after.filter(a => a.name === name);
    assert.equal(rows.length, 1, `Expected one ${name}`);
    return rows[0];
  };
  for (const addition of additions) {
    const existing = after.find(a => a.name === addition.name);
    if (existing) {
      assert.equal(existing.mbid, addition.mbid, `Unexpected identity: ${addition.name}`);
    } else {
      assert.ok(!after.some(a => a.mbid === addition.mbid), `MBID already owned: ${addition.name}`);
      after.push(structuredClone(addition));
    }
  }
  const bi2 = get('Би-2');
  withMbid(bi2, '5ca35ace-4006-4d4a-af04-5cd91dafab14');
  bi2.website = 'https://b2band.com/ru';
  addAliases(bi2, ['Bi-2']);
  const splean = get('Сплин');
  withMbid(splean, '0783b768-6719-450b-a7e1-7e891da17af3');
  addAliases(splean, ['Splean', 'Splin']);

  const lyapis = get('Ляпис Трубецкой');
  withMbid(lyapis, '452b56d2-c904-4030-ad12-6d4fbd498e1f');
  for (const name of ['Lyapis Trubetskoy', '♫Ляпис Трубецкой']) {
    const duplicate = after.find(a => a.name === name);
    if (!duplicate) continue;
    assert.equal(duplicate.mbid, lyapis.mbid, name);
    addAliases(lyapis, [name, ...(duplicate.aliases ?? [])]);
    if (lyapis.wikidataSitelinks === undefined && duplicate.wikidataSitelinks !== undefined) {
      lyapis.wikidataSitelinks = duplicate.wikidataSitelinks;
    }
    if (duplicate.lastConcertSeenAt && (!lyapis.lastConcertSeenAt || duplicate.lastConcertSeenAt > lyapis.lastConcertSeenAt)) {
      lyapis.lastConcertSeenAt = duplicate.lastConcertSeenAt;
    }
  }
  lyapis.website = 'https://lyapis.eu/';

  const mumiy = get('Мумий Тролль');
  withMbid(mumiy, 'f91b9b28-25b7-4064-81d1-f43163085770');
  const typo = after.find(a => a.name === 'Мумий троль');
  if (typo) {
    assert.ok(!typo.mbid || typo.mbid === mumiy.mbid);
    assert.ok(!typo.website || typo.website === mumiy.website);
    // The approved typo has the same genre, popularity and similarity inputs.
    assert.deepEqual(typo.genres, mumiy.genres);
    assert.deepEqual(typo.popularity, mumiy.popularity);
    assert.deepEqual(typo.similarArtists, mumiy.similarArtists);
    addAliases(mumiy, [typo.name, ...(typo.aliases ?? [])]);
  }
  addAliases(mumiy, ['Mumiy Troll']);

  const zemfira = get('Земфира');
  withMbid(zemfira, 'cec59910-2d12-46ec-8e39-85ca06acb0ed');
  const latin = after.find(a => a.name === 'Zemfira');
  if (latin) {
    assert.equal(latin.mbid, '7f5c2724-07d4-4bb8-856c-5e2928f77d9e');
    assert.equal(latin.socials?.spotify, zemfira.socials?.spotify);
    addAliases(zemfira, [latin.name, ...(latin.aliases ?? [])]);
    if (zemfira.wikidataSitelinks === undefined && latin.wikidataSitelinks !== undefined) {
      zemfira.wikidataSitelinks = latin.wikidataSitelinks;
    }
    // Keep canonical image/genres/popularity/similar/tier/seen timestamps.
    // The Latin row has the current official handles (WD Q242454).
    for (const [key, value] of Object.entries(latin.socials ?? {})) {
      if (value) zemfira.socials = { ...zemfira.socials, [key]: value };
    }
  }
  zemfira.website = 'https://zemfira.world';

  const doro = get('Doro Pesch');
  assert.equal(doro.mbid, '8f72ef7e-bc18-4c5d-a4ac-20a5a3a4ab33');
  doro.aliases = (doro.aliases ?? []).filter(a => a !== 'Дора');

  const de = get('Morgenstern');
  assert.equal(de.mbid, '2f9c67a0-19d8-4bb8-b1bf-40157eb4142f');
  // MB and the releasing label identify Andrea Börner's noise project.
  // Do not transfer opaque mixed Last.fm/Deezer values to either artist.
  de.website = null;
  for (const field of ['socials', 'image', 'popularity', 'metaEnrichedAt', 'similarArtists', 'similarEnrichedAt', 'lastConcertSeenAt']) delete de[field];
  de.genres = (de.genres ?? []).filter(g => g !== 'folk metal');

  const result = after.filter(a => !removedNames.includes(a.name));
  assertRuIdentityScope(before, result);
  return result;
}

/** Full entry comparison, including unknown fields; no global name-key merge. */
export function assertRuIdentityScope(before: ArtistEntry[], after: ArtistEntry[]): void {
  assert.deepEqual(after.filter(a => !ownedNames.has(a.name)), before.filter(a => !ownedNames.has(a.name)));
  assert.equal(new Set(after.map(a => a.name)).size, after.length, 'Duplicate canonical names');
}

export function repairRuTargets(raw: string): string {
  // Drop only the two exact confirmed duplicate targets. Preserve all other lines.
  const lines = raw.split('\n').filter(line => !['♫Ляпис Трубецкой', 'Мумий троль'].includes(line.trim()));
  while (lines.at(-1) === '') lines.pop();
  const seen = new Set(lines.map(line => line.trim().toLowerCase()));
  for (const name of RU_EXPLICIT_TARGETS) {
    if (!seen.has(name.toLowerCase())) {
      lines.push(name);
      seen.add(name.toLowerCase());
    }
  }
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  assert.ok(argv.length === 0 || (argv.length === 1 && argv[0] === '--apply'), 'Usage: repair_ru_artist_identities_20261016.ts [--apply]');
  const before = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR) as ArtistEntry[];
  const after = repairRuArtistIdentities(before);
  const beforeMap = new Map(before.map(a => [a.name, a]));
  const afterMap = new Map(after.map(a => [a.name, a]));
  console.log(JSON.stringify({ before: before.length, after: after.length,
    added: after.filter(a => !beforeMap.has(a.name)).map(a => a.name),
    removed: before.filter(a => !afterMap.has(a.name)).map(a => a.name),
    changed: after.filter(a => beforeMap.has(a.name) && JSON.stringify(a) !== JSON.stringify(beforeMap.get(a.name))).map(a => a.name),
  }, null, 2));
  const targetsPath = 'data/artist_scrape_targets.txt';
  const rawTargets = await readFile(targetsPath, 'utf8');
  const targets = repairRuTargets(rawTargets);
  if (!argv.includes('--apply')) return;
  // Refuse a stale snapshot even within this isolated worktree.
  assert.deepEqual(await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR), before);
  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, after);
  const persisted = await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR) as ArtistEntry[];
  // Storage sorts/re-shards. Compare complete named rows, not only counts/IDs.
  assert.deepEqual([...persisted].sort((a, b) => a.name.localeCompare(b.name)), [...after].sort((a, b) => a.name.localeCompare(b.name)));
  assert.deepEqual(await readFile(targetsPath, 'utf8'), rawTargets);
  if (targets !== rawTargets) await writeFile(targetsPath, targets, 'utf8');
  console.log('Applied through artistDb; complete persisted DB equals the scoped candidate.');
}

if (require.main === module) void main().catch(err => { console.error(err); process.exitCode = 1; });
