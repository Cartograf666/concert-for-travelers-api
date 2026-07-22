import * as fs from 'fs/promises';
import * as path from 'path';
import { stableJson } from './diffUtil.js';

type AuditEntry = Record<string, unknown>;

async function readAudit(filePath: string): Promise<AuditEntry[]> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array`);
  return parsed;
}

/**
 * Replays append-only tour URL audit entries made by one workflow run onto the
 * current checkout after that run had to reset to a newer origin/main.
 */
export async function reapplyTourUrlAuditDelta(
  beforePath: string,
  afterPath: string,
  currentPath = path.join(process.cwd(), 'data', 'tour-url-probe-hits.json')
): Promise<{ added: number; alreadyPresent: number }> {
  const [before, after, current] = await Promise.all([
    readAudit(beforePath),
    readAudit(afterPath),
    readAudit(currentPath)
  ]);
  const beforeEntries = new Set(before.map(stableJson));
  const currentEntries = new Set(current.map(stableJson));
  let added = 0;
  let alreadyPresent = 0;

  for (const entry of after) {
    const serialized = stableJson(entry);
    if (beforeEntries.has(serialized)) continue;
    if (currentEntries.has(serialized)) {
      alreadyPresent++;
      continue;
    }
    current.push(entry);
    currentEntries.add(serialized);
    added++;
  }

  if (added > 0) await fs.writeFile(currentPath, JSON.stringify(current, null, 2), 'utf-8');
  return { added, alreadyPresent };
}

async function main() {
  const [beforePath, afterPath, currentPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    throw new Error('Usage: reapply_tour_url_audit_delta.ts <before.json> <after.json> [current.json]');
  }
  const result = await reapplyTourUrlAuditDelta(beforePath, afterPath, currentPath);
  console.log(`[ReapplyTourUrlAuditDelta] added=${result.added}, alreadyPresent=${result.alreadyPresent}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ReapplyTourUrlAuditDelta] Fatal: ${err.message}`);
    process.exit(1);
  });
}
