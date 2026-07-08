import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Shared denylist guard: true for a genre/language/generic-descriptor term
 * (data/artist_denylist.json) that isn't itself a deliberate scrape target
 * (data/artist_scrape_targets.txt) -- the same "a user's explicit favorite
 * always wins over the denylist" exemption clean_denylist.ts applies when
 * removing existing entries, reused here so ADDING a new artist entry can
 * never (re)introduce exactly what clean_denylist.ts would immediately strip
 * back out. Only exact (normalized) matches count, never substrings -- a real
 * band whose name merely contains a genre word ("Jazz Sabbath") is unaffected.
 */
export interface DenylistGuard {
  isDenylisted(name: string): boolean;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

export async function loadDenylistGuard(root: string = process.cwd()): Promise<DenylistGuard> {
  const denylistPath = path.join(root, 'data', 'artist_denylist.json');
  const targetsPath = path.join(root, 'data', 'artist_scrape_targets.txt');

  let denyTerms: string[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(denylistPath, 'utf-8'));
    denyTerms = Array.isArray(parsed?.terms) ? parsed.terms : [];
  } catch {
    // Missing/unreadable denylist -> guard is a permissive no-op.
  }
  const deny = new Set(denyTerms.map(norm));

  let targets = new Set<string>();
  try {
    const raw = await fs.readFile(targetsPath, 'utf-8');
    targets = new Set(raw.split('\n').map(norm).filter(Boolean));
  } catch {
    // No target list -> the exemption just never applies.
  }

  return {
    isDenylisted(name: string): boolean {
      const key = norm(name);
      return deny.has(key) && !targets.has(key);
    }
  };
}
