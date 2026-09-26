import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { ArtistEntry } from '../schemas/artist.js';
import type { ProbeResult } from './discover_tour_urls.js';

type Candidate = { name: string; website: string };
type Mode = 'probe' | 'apply' | 'run';
type Intent = { index: number; beforeTried: string | null; beforeTour: string | null; appliedAt: string };
export interface State {
  version: 1;
  mode: Mode;
  limit: number | null;
  id: string;
  inputHash: string;
  candidates: Candidate[];
  nameCounts: number[] | null;
  results: ProbeResult[];
  skipped: number[];
  applied: number;
  pending: { end: number; entries: Intent[] } | null;
  complete: boolean;
}

export interface DiscoveryOptions {
  mode: Mode;
  checkpointFile: string;
  resultsFile?: string;
  auditFile: string;
  limit?: number;
  candidates?: Candidate[];
  results?: ProbeResult[];
  loadDb: () => Promise<ArtistEntry[]>;
  saveDb: (artists: ArtistEntry[]) => Promise<void>;
  select: (artists: ArtistEntry[], n: number) => Candidate[];
  eligible: (artist: ArtistEntry) => boolean;
  probeSlice: (candidates: Candidate[]) => Promise<ProbeResult[]>;
  // Fault injection observes actual durable boundaries, never used by CLI.
  afterSave?: (boundary: 'checkpoint' | 'results' | 'db' | 'audit') => Promise<void>;
}

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (): never => { throw new Error('Invalid tour discovery checkpoint; preserve it for inspection and explicitly move it aside to restart.'); };
const candidateValid = (c: Candidate): boolean => !!c && typeof c.name === 'string' && !!c.name && typeof c.website === 'string' && !!c.website;
const resultValid = (r: ProbeResult): boolean => candidateValid(r) && (r.tourUrl === null || typeof r.tourUrl === 'string') && (r.pathPattern === null || typeof r.pathPattern === 'string') && typeof r.reason === 'string';
const sameCandidate = (a: Candidate, b: Candidate): boolean => a.name === b.name && a.website === b.website;

export async function atomicDiscoveryJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await fs.unlink(temporary).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  }
}

async function readState(file: string): Promise<State | null> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf-8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { return invalid(); }
  return validateDiscoveryCheckpoint(envelope);
}

/** Validate imported runner state before installing it in the local journal. */
export function validateDiscoveryCheckpoint(value: unknown): State {
  const envelope = value as { digest: string; state: State };
  const s = envelope?.state;
  if (!s || envelope.digest !== hash(s) || s.version !== 1 || !['probe', 'apply', 'run'].includes(s.mode) ||
      typeof s.id !== 'string' || !s.id || typeof s.complete !== 'boolean' ||
      !(s.limit === null || (Number.isSafeInteger(s.limit) && s.limit >= 0)) ||
      !Array.isArray(s.candidates) || !s.candidates.every(candidateValid) ||
      (s.mode === 'run' ? !Array.isArray(s.nameCounts) || s.nameCounts.length !== s.candidates.length || !s.nameCounts.every(n => Number.isSafeInteger(n) && n > 0) : s.nameCounts !== null) ||
      !Array.isArray(s.results) || !s.results.every(resultValid) || s.results.length > s.candidates.length ||
      !Array.isArray(s.skipped) || !s.skipped.every(i => Number.isSafeInteger(i) && i >= 0 && i < s.results.length) ||
      new Set(s.skipped).size !== s.skipped.length || (s.mode !== 'run' && s.skipped.length > 0) ||
      !s.results.every((r, i) => sameCandidate(r, s.candidates[i])) ||
      !Number.isSafeInteger(s.applied) || s.applied < 0 || s.applied > s.results.length ||
      s.inputHash !== hash(s.candidates)) return invalid();
  if (s.pending !== null) {
    const p = s.pending;
    if (!p || !Number.isSafeInteger(p.end) || p.end <= s.applied || p.end > s.results.length || !Array.isArray(p.entries) ||
        !p.entries.every(e => e && Number.isSafeInteger(e.index) && e.index >= s.applied && e.index < p.end &&
          !s.skipped.includes(e.index) && (e.beforeTried === null || typeof e.beforeTried === 'string') && (e.beforeTour === null || typeof e.beforeTour === 'string') &&
          typeof e.appliedAt === 'string' && Number.isFinite(Date.parse(e.appliedAt))) ||
        new Set(p.entries.map(e => e.index)).size !== p.entries.length) return invalid();
  }
  if ((s.mode === 'probe' && (s.applied || s.pending)) ||
      (s.complete && (s.results.length !== s.candidates.length || s.pending || (s.mode !== 'probe' && s.applied !== s.results.length)))) return invalid();
  return s;
}

function uniqueEntry(artists: ArtistEntry[], candidate: Candidate): ArtistEntry | undefined {
  const matches = artists.filter(a => a.name.toLowerCase() === candidate.name.toLowerCase());
  if (matches.length !== 1) return undefined;
  return matches[0];
}

function snapshotEntry(artists: ArtistEntry[], candidate: Candidate, expectedCount: number): ArtistEntry | undefined {
  const matches = artists.filter(a => a.name.toLowerCase() === candidate.name.toLowerCase());
  if (matches.length !== expectedCount || !matches.some(a => a.website === candidate.website)) {
    throw new Error(`Checkpoint candidate changed or ambiguous: ${candidate.name}; explicitly resolve or move checkpoint aside.`);
  }
  if (matches.length > 1) {
    console.warn(`[discover-tour-urls] Skipping ambiguous name "${candidate.name}" (${matches.length} DB entries).`);
    return undefined;
  }
  return matches[0];
}

async function mergeAudit(file: string, additions: Record<string, unknown>[]): Promise<void> {
  if (!additions.length) return;
  let records: Record<string, unknown>[] = [];
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf-8'));
    if (!Array.isArray(parsed) || !parsed.every(r => r && typeof r === 'object')) throw new Error('Audit must contain a JSON array of records');
    records = parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const existing = new Set(records.map(r => r.discoveryOperationId));
  const missing = additions.filter(r => !existing.has(r.discoveryOperationId));
  if (missing.length) await atomicDiscoveryJson(file, [...records, ...missing]);
}

/** Local single-writer journal: only fully persisted slices are guaranteed resumable. */
export async function discoverWithCheckpoint(options: DiscoveryOptions): Promise<ProbeResult[]> {
  const o = options;
  const limit = o.mode === 'run' ? o.limit ?? 60 : null;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('run limit must be a non-negative integer');
  let state = await readState(o.checkpointFile);
  if (state && (state.mode !== o.mode || (!state.complete && state.limit !== limit))) throw new Error('Checkpoint mode/limit mismatch; explicitly move the checkpoint aside to restart.');
  const supplied = o.mode === 'apply' ? o.results?.map(r => ({ name: r.name, website: r.website })) : o.candidates;
  if (supplied && (!Array.isArray(supplied) || !supplied.every(candidateValid))) throw new Error('Candidates must be an array of non-empty name/website objects');
  if (o.mode === 'apply' && (!Array.isArray(o.results) || !o.results.every(resultValid))) throw new Error('Results must be a valid probe results array');
  if (state && supplied && (hash(supplied) !== state.inputHash || (o.mode === 'apply' && hash(o.results) !== hash(state.results)))) {
    throw new Error('Checkpoint input mismatch; explicitly move the checkpoint aside to start changed input.');
  }
  const saveState = async (): Promise<void> => {
    await atomicDiscoveryJson(o.checkpointFile, { digest: hash(state), state });
    await o.afterSave?.('checkpoint');
  };
  if (!state || (o.mode === 'run' && state.complete)) {
    const artists = o.mode === 'run' ? await o.loadDb() : null;
    const candidates = supplied ?? o.select(artists!, limit!);
    if (!Array.isArray(candidates) || !candidates.every(candidateValid)) throw new Error('Selected candidates must be valid name/website objects');
    state = { version: 1, mode: o.mode, limit, id: randomUUID(), inputHash: hash(candidates), candidates,
      nameCounts: artists ? candidates.map(c => artists.filter(a => a.name.toLowerCase() === c.name.toLowerCase()).length) : null,
      results: o.mode === 'apply' ? o.results! : [], skipped: [], applied: 0, pending: null, complete: false };
    await saveState();
  }
  const current = state;
  if (o.mode === 'run' && !current.complete) {
    const artists = await o.loadDb();
    for (const [index, candidate] of current.candidates.entries()) {
      snapshotEntry(artists, candidate, current.nameCounts![index]);
    }
  }
  const projectResults = async (): Promise<void> => {
    if (o.resultsFile) {
      await atomicDiscoveryJson(o.resultsFile, current.results);
      await o.afterSave?.('results');
    }
  };
  const applySaved = async (): Promise<void> => {
    while (current.applied < current.results.length) {
      if (!current.pending) {
        const artists = await o.loadDb();
        const end = Math.min(current.applied + 10, current.results.length);
        const entries: Intent[] = [];
        for (let index = current.applied; index < end; index++) {
          if (current.skipped.includes(index)) continue;
          const result = current.results[index];
          const entry = uniqueEntry(artists, result);
          // Existing/fresh tour decisions and websites always win over this probe.
          if (!entry || entry.website !== result.website || entry.tourUrl || entry.tourUrlProbeTriedAt ||
              (o.mode === 'run' && !o.eligible(entry))) continue;
          entries.push({ index, beforeTour: entry.tourUrl ?? null, beforeTried: entry.tourUrlProbeTriedAt ?? null, appliedAt: new Date().toISOString() });
        }
        current.pending = { end, entries };
        await saveState(); // write intent before any DB shard can change
      }
      const artists = await o.loadDb();
      const audit: Record<string, unknown>[] = [];
      let changed = false;
      for (const intent of current.pending.entries) {
        const result = current.results[intent.index];
        const entry = uniqueEntry(artists, result);
        if (!entry || entry.website !== result.website) continue;
        const expectedTour = result.tourUrl ?? intent.beforeTour;
        const alreadySaved = (entry.tourUrl ?? null) === expectedTour && entry.tourUrlProbeTriedAt === intent.appliedAt;
        const unchanged = (entry.tourUrl ?? null) === intent.beforeTour && (entry.tourUrlProbeTriedAt ?? null) === intent.beforeTried;
        if (!alreadySaved && (!unchanged || (o.mode === 'run' && !o.eligible(entry)))) continue;
        if (!alreadySaved) {
          entry.tourUrlProbeTriedAt = intent.appliedAt;
          if (result.tourUrl) entry.tourUrl = result.tourUrl;
          changed = true;
        }
        if (result.tourUrl) audit.push({ artist: entry.name, website: entry.website, tourUrl: result.tourUrl,
          pathPattern: result.pathPattern, reason: result.reason, appliedAt: intent.appliedAt,
          discoveryOperationId: `${current.id}:${intent.index}` });
      }
      if (changed) {
        await o.saveDb(artists);
        await o.afterSave?.('db');
      }
      await mergeAudit(o.auditFile, audit);
      await o.afterSave?.('audit');
      current.applied = current.pending.end;
      current.pending = null;
      await saveState();
    }
  };
  await projectResults(); // heal a projection interrupted after journal rename
  if (o.mode !== 'probe') await applySaved();
  while (current.results.length < current.candidates.length) {
    const slice = current.candidates.slice(current.results.length, current.results.length + 10);
    const artists = o.mode === 'run' ? await o.loadDb() : null;
    const toProbe = slice.filter((candidate, index) => {
      if (!artists) return true;
      const entry = snapshotEntry(artists, candidate, current.nameCounts![current.results.length + index]);
      return !!entry && o.eligible(entry);
    });
    const probed = toProbe.length ? await o.probeSlice(toProbe) : [];
    if (probed.length !== toProbe.length || !probed.every((r, i) => resultValid(r) && sameCandidate(r, toProbe[i]))) throw new Error('Probe slice returned invalid/mismatched results');
    let index = 0;
    const results = slice.map((candidate, offset) => {
      if (toProbe.includes(candidate)) return probed[index++];
      current.skipped.push(current.results.length + offset);
      return { ...candidate, tourUrl: null, pathPattern: null, reason: 'Skipped: fresh DB row is no longer eligible' };
    });
    if (results.length !== slice.length || !results.every((r, i) => resultValid(r) && sameCandidate(r, slice[i]))) throw new Error('Probe slice returned invalid/mismatched results');
    current.results.push(...results);
    await saveState();
    await projectResults();
    if (o.mode !== 'probe') await applySaved();
  }
  if (!current.complete) {
    current.complete = true;
    await saveState();
  }
  return current.results;
}
