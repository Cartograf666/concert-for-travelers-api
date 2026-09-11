import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { classifyArtistDiscoveryAudience } from '../pipeline/artist_discovery.js';
import { BALANCED_LISTENER_THRESHOLDS } from '../schemas/artist_discovery.js';

/**
 * Offline calibration aid for interpreting the listeners already stored in the
 * approved artist DB. It deliberately does not fetch metrics or alter the DB.
 */

export const FAME_CANDIDATES = {
  conservative: [2_000_000, 250_000, 25_000],
  balanced: BALANCED_LISTENER_THRESHOLDS,
  strict: [3_000_000, 500_000, 50_000]
} as const;

export type FameCandidateId = keyof typeof FAME_CANDIDATES;
export type FameClass = 'very-large' | 'large' | 'medium' | 'small' | 'unknown';
export type FameClassifications = Record<FameCandidateId, FameClass>;

export interface ArtistCalibrationRow {
  name: string;
  listeners: number | null;
  sitelinks: number | null;
  genres: string[];
  classifications: FameClassifications;
}

export interface ConcertCalibration {
  available: boolean;
  asOf: string | null;
  activeConcertCount: number;
  matchedConcertCount: number;
  unmatchedConcertCount: number;
  matchedActiveConcertNames: Array<{ name: string; concertCount: number; classifications: FameClassifications }>;
  unmatchedActiveConcertNames: Array<{ name: string; concertCount: number; reason: 'missing-name' | 'not-found' | 'ambiguous-name' }>;
  retentionByCandidate: Record<FameCandidateId, { top2: number; top3: number; all: number }>;
  genreTagCohorts: Record<string, {
    tags: string[];
    matchedActiveArtistNames: number;
    matchedActiveConcerts: number;
    classifications: Record<FameCandidateId, Record<FameClass, number>>;
  }>;
}

export interface FameCalibrationReport {
  model: {
    status: 'experimental';
    metric: 'stored-listeners';
    metricDate: 'unknown';
    unsupported: string[];
  };
  thresholds: typeof FAME_CANDIDATES;
  aggregate: { artistCount: number; classifications: Record<FameCandidateId, Record<FameClass, number>> };
  artists: ArtistCalibrationRow[];
  concerts: ConcertCalibration;
}

export interface CalibrationArgs {
  artistDbPath: string;
  concertsPath?: string;
  outputPath: string;
  asOf?: string;
}

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), 'reports', 'artist-fame-calibration.json');

function asPositiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function asNonNegativeFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Exact matching key for calibration only; it intentionally does not resolve aliases. */
export function normalizeArtistName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ') : '';
}

export function classifyListeners(listeners: unknown, thresholds: readonly [number, number, number]): FameClass {
  const value = asPositiveFinite(listeners);
  if (value === null) return 'unknown';
  if (value >= thresholds[0]) return 'very-large';
  if (value >= thresholds[1]) return 'large';
  if (value >= thresholds[2]) return 'medium';
  return 'small';
}

function classificationsFor(listeners: unknown): FameClassifications {
  return Object.fromEntries(Object.entries(FAME_CANDIDATES).map(([id, thresholds]) => [
    id,
    id === 'balanced' ? classifyArtistDiscoveryAudience(listeners) : classifyListeners(listeners, thresholds)
  ])) as FameClassifications;
}

function artistRow(raw: unknown): ArtistCalibrationRow {
  const artist = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const popularity = typeof artist.popularity === 'object' && artist.popularity !== null
    ? artist.popularity as Record<string, unknown>
    : {};
  const genres = Array.isArray(artist.genres)
    ? artist.genres.filter((genre): genre is string => typeof genre === 'string').map((genre) => genre.trim()).filter(Boolean).sort()
    : [];
  const listeners = asPositiveFinite(popularity.listeners);
  return {
    name: typeof artist.name === 'string' ? artist.name : '',
    listeners,
    sitelinks: asNonNegativeFinite(artist.wikidataSitelinks),
    genres,
    classifications: classificationsFor(listeners)
  };
}

function compareRows(a: ArtistCalibrationRow, b: ArtistCalibrationRow): number {
  return normalizeArtistName(a.name).localeCompare(normalizeArtistName(b.name))
    || a.name.localeCompare(b.name)
    || (a.listeners ?? -1) - (b.listeners ?? -1)
    || (a.sitelinks ?? -1) - (b.sitelinks ?? -1)
    || JSON.stringify(a.genres).localeCompare(JSON.stringify(b.genres));
}

export function aggregateArtists(artists: unknown[]): { artists: ArtistCalibrationRow[]; classifications: FameCalibrationReport['aggregate']['classifications'] } {
  const rows = artists.map(artistRow).sort(compareRows);
  const classifications = Object.fromEntries(Object.keys(FAME_CANDIDATES).map((id) => [
    id,
    { 'very-large': 0, large: 0, medium: 0, small: 0, unknown: 0 }
  ])) as FameCalibrationReport['aggregate']['classifications'];
  for (const row of rows) {
    for (const id of Object.keys(FAME_CANDIDATES) as FameCandidateId[]) classifications[id][row.classifications[id]]++;
  }
  return { artists: rows, classifications };
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function emptyRetention(): ConcertCalibration['retentionByCandidate'] {
  return Object.fromEntries(Object.keys(FAME_CANDIDATES).map((id) => [id, { top2: 0, top3: 0, all: 0 }])) as ConcertCalibration['retentionByCandidate'];
}

const GENRE_TAG_COHORTS: Record<string, readonly string[]> = {
  russian: ['russian'],
  japanese: ['japanese', 'j-pop', 'j-rock'],
  korean: ['korean', 'k-pop', 'kpop'],
  latin: ['latin', 'reggaeton'],
  african: ['african', 'afrobeats', 'afrobeat', 'nigeria'],
  indian: ['indian', 'bollywood', 'hindi', 'qawwali'],
  jazz: ['jazz'],
  metal: ['metal'],
  electronic: ['electronic', 'techno', 'house'],
  pop: ['pop']
};

function emptyClassifications(): FameCalibrationReport['aggregate']['classifications'] {
  return Object.fromEntries(Object.keys(FAME_CANDIDATES).map((id) => [
    id,
    { 'very-large': 0, large: 0, medium: 0, small: 0, unknown: 0 }
  ])) as FameCalibrationReport['aggregate']['classifications'];
}

function emptyGenreTagCohorts(): ConcertCalibration['genreTagCohorts'] {
  return Object.fromEntries(Object.entries(GENRE_TAG_COHORTS).map(([name, tags]) => [name, {
    tags: [...tags], matchedActiveArtistNames: 0, matchedActiveConcerts: 0, classifications: emptyClassifications()
  }])) as ConcertCalibration['genreTagCohorts'];
}

/** Aggregates a snapshot without editing or filtering the original concert array. */
export function aggregateConcerts(snapshot: unknown, artists: ArtistCalibrationRow[], asOf: string): ConcertCalibration {
  const byName = new Map<string, ArtistCalibrationRow[]>();
  for (const artist of artists) {
    const key = normalizeArtistName(artist.name);
    if (!key) continue;
    const matches = byName.get(key) ?? [];
    matches.push(artist);
    byName.set(key, matches);
  }
  const names = new Map<string, { name: string; concertCount: number; reason?: 'missing-name' | 'not-found' | 'ambiguous-name' }>();
  let activeConcertCount = 0;
  for (const concert of Array.isArray(snapshot) ? snapshot : []) {
    const row = typeof concert === 'object' && concert !== null ? concert as Record<string, unknown> : {};
    if (!validDate(row.date) || row.date < asOf) continue;
    activeConcertCount++;
    const name = typeof row.artist === 'string' ? row.artist.trim() : '';
    const key = normalizeArtistName(name);
    const matches = key ? byName.get(key) : undefined;
    const reason = !name ? 'missing-name' : !matches ? 'not-found' : matches.length !== 1 ? 'ambiguous-name' : undefined;
    const mapKey = `${reason ?? 'matched'}\u0000${key}`;
    const displayName = name || '(missing artist)';
    const previous = names.get(mapKey);
    names.set(mapKey, {
      name: previous && previous.name.localeCompare(displayName) < 0 ? previous.name : displayName,
      concertCount: (previous?.concertCount ?? 0) + 1,
      reason
    });
  }

  const retentionByCandidate = emptyRetention();
  const genreTagCohorts = emptyGenreTagCohorts();
  const matchedActiveConcertNames: ConcertCalibration['matchedActiveConcertNames'] = [];
  const unmatchedActiveConcertNames: ConcertCalibration['unmatchedActiveConcertNames'] = [];
  let matchedConcertCount = 0;
  let unmatchedConcertCount = 0;
  for (const [mapKey, item] of names) {
    if (item.reason) {
      unmatchedConcertCount += item.concertCount;
      unmatchedActiveConcertNames.push({ name: item.name, concertCount: item.concertCount, reason: item.reason });
      continue;
    }
    const artist = byName.get(mapKey.slice('matched\u0000'.length))![0];
    matchedConcertCount += item.concertCount;
    matchedActiveConcertNames.push({ name: item.name, concertCount: item.concertCount, classifications: artist.classifications });
    for (const id of Object.keys(FAME_CANDIDATES) as FameCandidateId[]) {
      const category = artist.classifications[id];
      if (category === 'very-large' || category === 'large') retentionByCandidate[id].top2 += item.concertCount;
      if (category !== 'small' && category !== 'unknown') retentionByCandidate[id].top3 += item.concertCount;
    }
    const genreTags = artist.genres.map((genre) => genre.normalize('NFKC').toLowerCase());
    for (const [cohort, tags] of Object.entries(GENRE_TAG_COHORTS)) {
      const matchesCohort = tags.some((tag) => cohort === 'pop'
        ? genreTags.some((genre) => genre === tag)
        : genreTags.some((genre) => genre.includes(tag)));
      if (!matchesCohort) continue;
      const target = genreTagCohorts[cohort];
      target.matchedActiveArtistNames++;
      target.matchedActiveConcerts += item.concertCount;
      for (const id of Object.keys(FAME_CANDIDATES) as FameCandidateId[]) target.classifications[id][artist.classifications[id]]++;
    }
  }
  // "all" is the complete active snapshot: unmatched and ambiguous source rows
  // remain visible rather than being silently discarded by the calibration.
  for (const id of Object.keys(FAME_CANDIDATES) as FameCandidateId[]) retentionByCandidate[id].all = activeConcertCount;
  const byNameOrder = (a: { name: string }, b: { name: string }) => normalizeArtistName(a.name).localeCompare(normalizeArtistName(b.name)) || a.name.localeCompare(b.name);
  matchedActiveConcertNames.sort(byNameOrder);
  unmatchedActiveConcertNames.sort(byNameOrder);
  return { available: true, asOf, activeConcertCount, matchedConcertCount, unmatchedConcertCount, matchedActiveConcertNames, unmatchedActiveConcertNames, retentionByCandidate, genreTagCohorts };
}

export function buildCalibrationReport(artists: unknown[], snapshot?: unknown, asOf?: string): FameCalibrationReport {
  if (snapshot !== undefined && !validDate(asOf)) throw new Error('a valid asOf date is required when aggregating concerts');
  const aggregate = aggregateArtists(artists);
  return {
    model: {
      status: 'experimental',
      metric: 'stored-listeners',
      metricDate: 'unknown',
      unsupported: ['global-or-current-popularity', 'confidence', 'trend', 'peakEra', 'generation']
    },
    thresholds: FAME_CANDIDATES,
    aggregate: { artistCount: aggregate.artists.length, classifications: aggregate.classifications },
    artists: aggregate.artists,
    concerts: snapshot === undefined
      ? { available: false, asOf: null, activeConcertCount: 0, matchedConcertCount: 0, unmatchedConcertCount: 0, matchedActiveConcertNames: [], unmatchedActiveConcertNames: [], retentionByCandidate: emptyRetention(), genreTagCohorts: emptyGenreTagCohorts() }
      : aggregateConcerts(snapshot, aggregate.artists, asOf!)
  };
}

export function parseCalibrationArgs(args: string[]): CalibrationArgs {
  const result: Partial<CalibrationArgs> = { artistDbPath: PRODUCTION_ARTIST_DB_DIR, outputPath: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--artist-db', '--concerts', '--output', '--as-of'].includes(flag)) throw new Error(`unknown argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--artist-db') result.artistDbPath = value;
    if (flag === '--concerts') result.concertsPath = value;
    if (flag === '--output') result.outputPath = value;
    if (flag === '--as-of') result.asOf = value;
  }
  if (result.concertsPath && !result.asOf) throw new Error('--as-of YYYY-MM-DD is required with --concerts');
  if (!result.concertsPath && result.asOf) throw new Error('--as-of is only valid with --concerts');
  if (result.asOf && !validDate(result.asOf)) throw new Error(`invalid --as-of date: ${result.asOf}`);
  return result as CalibrationArgs;
}

async function readArtistDbRaw(location: string): Promise<{ artists: unknown[]; files: Array<{ path: string; bytes: Buffer }> }> {
  const filenames = location.toLowerCase().endsWith('.json')
    ? [location]
    : (await fs.readdir(location)).filter((file) => /^shard-\d+\.json$/.test(file)).sort().map((file) => path.join(location, file));
  const files = await Promise.all(filenames.map(async (filename) => ({ path: filename, bytes: await fs.readFile(filename) })));
  const artists: unknown[] = [];
  for (const file of files) {
    const parsed: unknown = JSON.parse(file.bytes.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error(`artist DB file must contain an array: ${file.path}`);
    artists.push(...parsed);
  }
  return { artists, files };
}

function sha256(parts: Array<string | Buffer>): string {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

export async function runCalibration(options: CalibrationArgs): Promise<FameCalibrationReport & { input: Record<string, unknown> }> {
  const output = path.resolve(options.outputPath);
  const artistDb = path.resolve(options.artistDbPath);
  const concerts = options.concertsPath ? path.resolve(options.concertsPath) : undefined;
  const outputInsideArtistDb = !artistDb.toLowerCase().endsWith('.json') && (output === artistDb || output.startsWith(`${artistDb}${path.sep}`));
  if (output === artistDb || output === concerts || outputInsideArtistDb) {
    throw new Error('--output must not overwrite an artist DB input, a concert snapshot, or a file inside the artist DB directory');
  }
  const db = await readArtistDbRaw(options.artistDbPath);
  const concertBytes = options.concertsPath ? await fs.readFile(options.concertsPath) : undefined;
  let snapshot: unknown;
  if (concertBytes) {
    snapshot = JSON.parse(concertBytes.toString('utf8'));
    if (!Array.isArray(snapshot)) throw new Error(`concert snapshot must contain an array: ${options.concertsPath}`);
  }
  const report = buildCalibrationReport(db.artists, snapshot, options.asOf);
  const dbParts = db.files.flatMap((file) => [path.basename(file.path), '\u0000', file.bytes, '\u0000'] as Array<string | Buffer>);
  const input = {
    artistDbPath: options.artistDbPath,
    artistDbFiles: db.files.map((file) => path.basename(file.path)),
    artistDbSha256: sha256(dbParts),
    concertsPath: options.concertsPath ?? null,
    concertsSha256: concertBytes ? sha256([concertBytes]) : null,
    combinedSha256: sha256([...dbParts, concertBytes ? 'concerts\u0000' : 'no-concerts\u0000', concertBytes ?? ''])
  };
  return { ...report, input };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCalibrationArgs(args);
  const report = await runCalibration(options);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[FameCalibration] ${report.aggregate.artistCount} artists -> ${options.outputPath}`);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(`[FameCalibration] ${error.message}`);
    process.exitCode = 1;
  });
}
