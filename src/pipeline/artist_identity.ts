/** Publication-only projection. Never persist this view over the artist DB.
 * Evidence: the named rows in data/artists share the IDs/site below (2026-10-27).
 * This finite registry handles different names; formatting-only variants below
 * additionally require both common MBID and Spotify IDs and conflict guards. Neither equates arbitrary shared-ID projects
 * or trusts the DB's broad alias lists (e.g. KoRn also lists Brian Welch/L.A.P.D).
 */
const COHORTS = [
  { name: 'A. R. Rahman', names: ['A. R. Rahman', 'A.R. Rahman', 'A.R.Rahman'],
    mbid: 'e0bba708-bdd3-478d-84ea-c706413bedab', spotify: '1mYsTxnqsietFxj1OgoGbG', host: 'arrahman.com' },
  { name: 'AURORA', names: ['AURORA', 'Aurora Aksnes'],
    mbid: '484a4e90-6899-4e4b-a948-a2255d365340', spotify: '1WgXqy2Dd70QQOU7Ay074N', host: 'aurora-music.com' },
  { name: 'KoRn', names: ['KoRn', 'KoЯn'],
    mbid: 'ac865b2e-bba8-4f5a-8756-dd40d5e39f46', spotify: '3RNrq3jvMZxD9ZyoOZbQOD', host: 'kornofficial.com' }
] as const;

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const formatKey = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const nameOf = (a: any): string => typeof a === 'string' ? a : a?.name ?? '';

function spotifyId(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.hostname !== 'open.spotify.com') return;
    return url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?artist\/([A-Za-z0-9]+)\/?$/)?.[1];
  } catch { return; }
}

export interface ArtistIdentityProjection {
  artists: any[];
  /** Includes only the finite evidence-backed cohort names, not every DB alias. */
  canonicalNames: Map<string, string>;
  compatibilityNames: Map<string, string[]>;
  conflicts: string[];
}

export function projectArtistIdentities(approvedArtists: any[]): ArtistIdentityProjection {
  const replacements = new Map<any, any>();
  const canonicalNames = new Map<string, string>();
  const compatibilityNames = new Map<string, string[]>();
  const conflicts: string[] = [];
  for (const cohort of COHORTS) {
    const names = new Set(cohort.names.map(key));
    const rows = approvedArtists.filter(a => names.has(key(nameOf(a))));
    if (!rows.length) continue;
    const corroborated = rows.every(a => {
      if (!a || typeof a !== 'object') return false;
      const id = spotifyId(a.socials?.spotify);
      if ((a.mbid && a.mbid !== cohort.mbid) || (a.socials?.spotify && id !== cohort.spotify)) return false;
      if (a.website) {
        try {
          if (new URL(a.website).hostname.replace(/^www\./, '') !== cohort.host) return false;
        } catch { return false; }
      }
      // Names alone or a shared homepage do not establish the performer.
      return a.mbid === cohort.mbid || id === cohort.spotify;
    });
    if (!corroborated) { conflicts.push(cohort.name); continue; }
    // Stable metadata from the canonical entry; never mash conflicting profiles
    // together. Only searchable alias names are unioned.
    const primary = rows.find(a => nameOf(a) === cohort.name) ?? rows[0];
    const aliases = new Set<string>(cohort.names);
    for (const a of rows) {
      for (const alias of a.aliases ?? []) if (typeof alias === 'string') aliases.add(alias);
    }
    aliases.delete(cohort.name);
    const projected = { ...primary, name: cohort.name, aliases: [...aliases] };
    for (const a of rows) replacements.set(a, projected);
    for (const name of cohort.names) canonicalNames.set(key(name), cohort.name);
    compatibilityNames.set(cohort.name, [...cohort.names].filter(n => n !== cohort.name));
  }
  const curated = [...new Set(approvedArtists.map(a => replacements.get(a) ?? a))];
  const byFormat = new Map<string, any[]>();
  for (const artist of curated) {
    // A blocked finite cohort cannot sneak back through a generic rule.
    if (COHORTS.some(c => c.names.some(n => key(n) === key(nameOf(artist))))) continue;
    const formatted = formatKey(nameOf(artist));
    if (!formatted) continue;
    const group = byFormat.get(formatted) ?? [];
    group.push(artist);
    byFormat.set(formatted, group);
  }
  const formattingReplacements = new Map<any, any>();
  for (const [formatted, rows] of byFormat) {
    if (rows.length < 2) continue;
    const mbids = new Set(rows.map(a => a?.mbid).filter(Boolean));
    const spotifyIds = new Set(rows.map(a => spotifyId(a?.socials?.spotify)).filter(Boolean));
    const hosts = new Set<string>();
    let malformed = false;
    for (const a of rows) {
      if (!a || typeof a !== 'object') { malformed = true; continue; }
      if (a.socials?.spotify && !spotifyId(a.socials.spotify)) malformed = true;
      if (a.website) {
        try { hosts.add(new URL(a.website).hostname.replace(/^www\./, '')); }
        catch { malformed = true; }
      }
    }
    const commonMbid = mbids.size === 1 && rows.every(a => a?.mbid === [...mbids][0]);
    const commonSpotify = spotifyIds.size === 1 && rows.every(a => spotifyId(a?.socials?.spotify) === [...spotifyIds][0]);
    if (malformed || mbids.size > 1 || spotifyIds.size > 1 || hosts.size > 1 || (!commonMbid || !commonSpotify)) {
      conflicts.push(`format:${formatted}`);
      continue;
    }
    const primary = [...rows].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'en'))[0];
    const name = nameOf(primary);
    const oldNames = rows.map(nameOf).filter(n => n !== name);
    const aliases = new Set<string>(oldNames);
    for (const a of rows) for (const alias of a.aliases ?? []) if (typeof alias === 'string' && alias !== name) aliases.add(alias);
    const projected = { ...primary, aliases: [...aliases] };
    for (const a of rows) {
      formattingReplacements.set(a, projected);
      canonicalNames.set(key(nameOf(a)), name);
    }
    compatibilityNames.set(name, oldNames);
  }
  return { artists: [...new Set(curated.map(a => formattingReplacements.get(a) ?? a))], canonicalNames,
    compatibilityNames, conflicts };
}

export function canonicalArtistName(name: string, projection: ArtistIdentityProjection): string {
  return projection.canonicalNames.get(key(name)) ?? name;
}
