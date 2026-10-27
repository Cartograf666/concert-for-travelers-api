/** Explicit one-artist rescue; independent empty cache, no shared cache save. */
import axios from 'axios';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fetchBandsintownConcerts, type BandsintownCache } from '../../../src/engine/bandsintown.js';
async function main() {
  const cache: BandsintownCache = {};
  const native: unknown[] = [];
  const startedAt = new Date().toISOString();
  const interceptor = axios.interceptors.response.use(response => {
    const url = new URL(response.config.url || '');
    if (url.hostname === 'rest.bandsintown.com' && url.pathname.endsWith('/events')) {
      native.push({ endpoint: `${url.origin}${url.pathname}`, status: response.status, receivedAt: new Date().toISOString(), data: response.data });
    }
    return response;
  });
  let health: unknown;
  try {
    const raw = await fetchBandsintownConcerts(['King Gizzard & The Lizard Wizard'], { cache, maxPerRun: 1, onHealth: report => { health = report; } });
    const payload = { startedAt, completedAt: new Date().toISOString(), sourceClass: 'aggregator-bandsintown', independentOfficial: false, scope: { artists: ['King Gizzard & The Lizard Wizard'], maxPerRun: 1, initialCacheEntries: 0 }, health, native, raw, isolatedCache: cache };
    const serialized = JSON.stringify(payload, null, 2) + '\n';
    await writeFile('tests/fixtures/official-remaining-20261028/king-bit-runtime.json', serialized);
    console.log(JSON.stringify({ rawCount: raw.length, nativeResponses: native.length, sha256: createHash('sha256').update(serialized).digest('hex'), health }));
  } finally { axios.interceptors.response.eject(interceptor); }
}
void main();
