import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { loadApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import type { ArtistEntry } from '../schemas/artist.js';
import { atomicDiscoveryJson, validateDiscoveryCheckpoint, type State } from './tourUrlDiscoveryCheckpoint.js';

interface RowCheck {
  index: number;
  tourUrl: string | null;
  triedAt: string | null;
}
interface Payload {
  version: 1;
  journal: unknown;
  rows: RowCheck[];
  audit: Record<string, unknown>[];
}
export interface RunnerOptions {
  checkpointFile: string;
  bundleFile: string;
  auditFile: string;
  limit: number;
  loadDb: () => Promise<ArtistEntry[]>;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (detail: string): never => { throw new Error(`Discovery runner checkpoint ${detail}; preserve state and explicitly resolve it before restarting.`); };
const textOrNull = (value: unknown): boolean => value === null || typeof value === 'string';

async function jsonOrAbsent(file: string): Promise<unknown | undefined> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function auditRecords(file: string): Promise<Record<string, unknown>[]> {
  const loaded = await jsonOrAbsent(file);
  const value = loaded === undefined ? [] : loaded;
  if (!Array.isArray(value) || !value.every(record => record && typeof record === 'object' && !Array.isArray(record))) fail('has invalid audit');
  return value as Record<string, unknown>[];
}

function candidateRows(state: State, artists: ArtistEntry[]): (ArtistEntry | undefined)[] {
  return state.candidates.map((candidate, index) => {
    const matches = artists.filter(artist => artist.name.toLowerCase() === candidate.name.toLowerCase());
    if (matches.length !== state.nameCounts![index] || !matches.some(artist => artist.website === candidate.website)) fail(`candidate changed: ${candidate.name}`);
    return matches.length === 1 ? matches[0] : undefined;
  });
}

function appliedIndexes(state: State): number[] {
  return Array.from({ length: state.applied }, (_, index) => index).filter(index => state.nameCounts![index] === 1);
}

function validatePayload(value: unknown): { payload: Payload; state: State } {
  const envelope = value as { digest: string; payload: Payload };
  const payload = envelope?.payload;
  if (!payload || envelope.digest !== digest(payload) || payload.version !== 1) fail('has invalid bundle/version/checksum');
  const state = validateDiscoveryCheckpoint(payload.journal);
  if (state.mode !== 'run') fail('mode mismatch');
  const indexes = appliedIndexes(state);
  if (!Array.isArray(payload.rows) || payload.rows.length !== indexes.length ||
      !payload.rows.every((row, i) => row && row.index === indexes[i] && textOrNull(row.tourUrl) && textOrNull(row.triedAt))) fail('has invalid applied-row checks');
  if (!Array.isArray(payload.audit) || !payload.audit.every(record => record && typeof record === 'object' && !Array.isArray(record) &&
      typeof record.discoveryOperationId === 'string' && record.discoveryOperationId.startsWith(`${state.id}:`) &&
      /^\d+$/.test(record.discoveryOperationId.slice(state.id.length + 1)) &&
      Number(record.discoveryOperationId.slice(state.id.length + 1)) < state.results.length) ||
      new Set(payload.audit.map(record => record.discoveryOperationId)).size !== payload.audit.length) fail('has invalid audit checks');
  return { payload, state };
}

/** Restore from the same Git snapshot as DB/audit; never copy an old DB over a fresh one. */
export async function restoreRunnerCheckpoint(options: RunnerOptions): Promise<boolean> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 0) fail('limit is invalid');
  const value = await jsonOrAbsent(options.bundleFile);
  if (value === undefined) {
    // An unbundled local journal is not evidence of cross-runner persistence.
    if (await jsonOrAbsent(options.checkpointFile) !== undefined) fail('has an unbundled local journal');
    return false;
  }
  const { payload, state } = validatePayload(value);
  if (!state.complete && state.limit !== options.limit) fail('limit mismatch');
  const rows = candidateRows(state, await options.loadDb());
  for (const check of payload.rows) {
    const row = rows[check.index]!;
    if ((row.tourUrl ?? null) !== check.tourUrl || (row.tourUrlProbeTriedAt ?? null) !== check.triedAt) fail(`applied DB outcome missing/changed: ${row.name}`);
  }
  const audit = await auditRecords(options.auditFile);
  for (const check of payload.audit) {
    const matches = audit.filter(record => record.discoveryOperationId === check.discoveryOperationId);
    if (matches.length !== 1 || digest(matches[0]) !== digest(check)) fail(`audit outcome missing/changed: ${String(check.discoveryOperationId)}`);
  }
  // Completed runs permit a new limit/catalog selection, but still verify their
  // persisted outcomes: a conflict replay may have skipped a completed DB row.
  await atomicDiscoveryJson(options.checkpointFile, payload.journal);
  return true;
}

/** Local export only. Durability starts when workflow pushes DB/audit/bundle together. */
export async function exportRunnerCheckpoint(options: RunnerOptions): Promise<boolean> {
  const journal = await jsonOrAbsent(options.checkpointFile);
  if (journal === undefined) return false;
  const state = validateDiscoveryCheckpoint(journal);
  if (state.mode !== 'run' || state.limit !== options.limit) fail('export mode/limit mismatch');
  const rows = candidateRows(state, await options.loadDb());
  const checks = appliedIndexes(state).map(index => ({ index, tourUrl: rows[index]!.tourUrl ?? null, triedAt: rows[index]!.tourUrlProbeTriedAt ?? null }));
  const audit = (await auditRecords(options.auditFile)).filter(record => typeof record.discoveryOperationId === 'string' && record.discoveryOperationId.startsWith(`${state.id}:`));
  const payload: Payload = { version: 1, journal, rows: checks, audit };
  validatePayload({ payload, digest: digest(payload) });
  await atomicDiscoveryJson(options.bundleFile, { digest: digest(payload), payload });
  return true;
}

async function main(): Promise<void> {
  const [mode, count] = process.argv.slice(2);
  const options: RunnerOptions = {
    checkpointFile: path.join(process.cwd(), 'data', 'tour-url-discovery.checkpoint.json'),
    bundleFile: path.join(process.cwd(), 'data', 'tour-url-discovery-state', 'checkpoint.json'),
    auditFile: path.join(process.cwd(), 'data', 'tour-url-probe-hits.json'),
    limit: Number(count),
    loadDb: () => loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR),
  };
  if (mode === 'restore') await restoreRunnerCheckpoint(options);
  else if (mode === 'export') {
    if (!await exportRunnerCheckpoint(options)) fail('has no initialized journal to export');
  } else throw new Error('Usage: tourUrlDiscoveryRunner.ts <restore|export> <count>');
}

if (require.main === module) {
  main().catch(error => { console.error(`[DiscoveryRunner] ${error.message}`); process.exitCode = 1; });
}
