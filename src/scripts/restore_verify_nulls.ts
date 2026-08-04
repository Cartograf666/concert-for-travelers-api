import * as fs from 'fs/promises';
import * as path from 'path';
import { loadApprovedArtists, saveApprovedArtists, PRODUCTION_ARTIST_DB_DIR } from '../pipeline/artistDb.js';
import { isInfraHost, publicResolverAgreesNxdomain, nameMatches } from '../pipeline/verify_enrichment.js';
import type { ArtistEntry } from '../schemas/artist.js';

/**
 * Undoes the DNS-driven nulls of a verify sweep, field by field, from its own audit.
 *
 * Why this exists rather than `git restore data/artists/shard-N.json`: a bulk file
 * revert is both too broad and too narrow. Too broad because it also resurrects the
 * nulls that were CORRECT (hallucinated Spotify ids, real HTTP 404s) and discards any
 * concurrent writer's edits to unrelated artists in the same shard. Too narrow because
 * it only works while the damage is still uncommitted.
 *
 * A null is restored only when the reason it was removed is not evidence about the
 * data: `domain does not resolve` on a host that either can never legitimately vanish
 * (facebook/instagram/youtube/spotify/vk/telegram -- a dead ACCOUNT returns a real HTTP
 * 404 from a live server) or that a public resolver can still see. Every other null --
 * HTTP 404, invalid Spotify id, identity mismatch, and NXDOMAIN corroborated by public
 * DNS -- is left in place, because those verdicts are about the link, not the network.
 *
 *   restore-verify-nulls              dry run: classify every audited null, write nothing
 *   restore-verify-nulls --apply      write the restorations back to the artist DB
 *   restore-verify-nulls --report P   read the audit from P (default reports/verify-report.json)
 */

interface AuditRow { name: string; field: string; url: string; reach: string; note?: string }

const DNS_NOTE = 'domain does not resolve';
const SOCIAL_FIELDS = new Set(['spotify', 'instagram', 'facebook', 'youtube', 'telegram', 'vk']);

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function currentValue(a: ArtistEntry, field: string): unknown {
  if (field === 'website') return a.website;
  if (field === 'tourUrl') return a.tourUrl;
  return (a.socials as Record<string, unknown> | undefined)?.[field];
}

function setValue(a: ArtistEntry, field: string, value: string): void {
  if (field === 'website') { a.website = value; return; }
  if (field === 'tourUrl') { a.tourUrl = value; return; }
  a.socials = { ...(a.socials || {}), [field]: value };
}

/**
 * Decides one audited null. Resolves against public DNS only for non-infra hosts,
 * memoized per host so a sweep that nulled 151 facebook links costs one lookup.
 */
async function shouldRestore(row: AuditRow, entry: ArtistEntry, cache: Map<string, boolean>): Promise<{ restore: boolean; reason: string }> {
  // An identity mismatch recorded by an OLDER, broken matcher. The note carries
  // the exact title the endpoint returned, so the current matcher can re-judge
  // the same evidence without a single network call -- and it now knows about
  // aliases and non-Latin scripts, which is what produced these verdicts.
  const mismatch = row.note?.match(/^oembed name "(.+)" != artist$/);
  if (mismatch) {
    const title = mismatch[1];
    const knownAs = [entry.name, ...(entry.aliases || [])];
    if (knownAs.some((n) => nameMatches(n, title) || nameMatches(title, n))) {
      return { restore: true, reason: 'name matches under the current matcher (alias / script / spacing)' };
    }
    return { restore: false, reason: `identity mismatch stands ("${title}")` };
  }

  if (row.note !== DNS_NOTE) return { restore: false, reason: `not DNS-driven (${row.note})` };
  const host = hostOf(row.url);
  if (!host) return { restore: false, reason: 'unparseable url' };
  if (isInfraHost(host)) return { restore: true, reason: 'platform host — DNS is never evidence here' };

  let dead = cache.get(host);
  if (dead === undefined) {
    dead = await publicResolverAgreesNxdomain(host);
    cache.set(host, dead);
  }
  return dead
    ? { restore: false, reason: 'public DNS agrees NXDOMAIN — genuinely dead' }
    : { restore: true, reason: 'resolves on public DNS — local resolver was wrong' };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const reportIdx = argv.indexOf('--report');
  const reportPath = reportIdx >= 0 && argv[reportIdx + 1]
    ? argv[reportIdx + 1]
    : path.join(process.cwd(), 'reports', 'verify-report.json');

  const report = JSON.parse(await fs.readFile(reportPath, 'utf-8')) as { audit?: AuditRow[] };
  const audit = report.audit ?? [];
  if (audit.length === 0) {
    console.error(`[Restore] No audit rows in ${reportPath} — nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const db = (await loadApprovedArtists(PRODUCTION_ARTIST_DB_DIR)) as ArtistEntry[];
  const byName = new Map<string, ArtistEntry>();
  for (const a of db) if (!byName.has(a.name)) byName.set(a.name, a);

  const cache = new Map<string, boolean>();
  const restored: AuditRow[] = [];
  const kept = new Map<string, number>();
  const skipped: string[] = [];

  for (const row of audit) {
    if (!SOCIAL_FIELDS.has(row.field) && row.field !== 'website' && row.field !== 'tourUrl') {
      skipped.push(`${row.name}: unknown field ${row.field}`);
      continue;
    }
    const entry = byName.get(row.name);
    if (!entry) { skipped.push(`${row.name}: no longer in the DB`); continue; }

    const verdict = await shouldRestore(row, entry, cache);
    if (!verdict.restore) {
      kept.set(verdict.reason, (kept.get(verdict.reason) || 0) + 1);
      continue;
    }
    // Only ever fill a hole. If something already re-populated the field, that value
    // is newer than this audit and must win.
    const now = currentValue(entry, row.field);
    if (now != null && now !== '') { skipped.push(`${row.name}.${row.field}: already repopulated`); continue; }

    if (apply) setValue(entry, row.field, row.url);
    restored.push(row);
  }

  const byField: Record<string, number> = {};
  for (const r of restored) byField[r.field] = (byField[r.field] || 0) + 1;

  console.log(`[Restore] audit rows: ${audit.length}`);
  console.log(`[Restore] to restore: ${restored.length} ${JSON.stringify(byField)}`);
  console.log(`[Restore] left nulled: ${audit.length - restored.length - skipped.length}`);
  for (const [reason, n] of [...kept].sort((a, b) => b[1] - a[1])) console.log(`           ${String(n).padStart(4)}  ${reason}`);
  if (skipped.length) console.log(`[Restore] skipped: ${skipped.length}\n           ${skipped.slice(0, 10).join('\n           ')}`);

  if (!apply) {
    console.log('[Restore] DRY RUN — nothing written. Re-run with --apply to write.');
    return;
  }

  // Clear the verification stamps on every touched artist so the (fixed) sweep
  // re-examines them instead of trusting the run that got them wrong.
  for (const r of restored) {
    const e = byName.get(r.name) as (ArtistEntry & { verifiedAt?: string; verifyTriedAt?: string }) | undefined;
    if (e) { delete e.verifiedAt; delete e.verifyTriedAt; }
  }

  await saveApprovedArtists(PRODUCTION_ARTIST_DB_DIR, db);
  console.log(`[Restore] Wrote ${restored.length} field(s) back to ${PRODUCTION_ARTIST_DB_DIR} and cleared their verification stamps.`);
}

main().catch((err) => { console.error('[Restore] fatal:', err); process.exitCode = 1; });
