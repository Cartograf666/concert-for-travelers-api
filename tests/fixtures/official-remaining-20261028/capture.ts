/** Opt-in public HTML capture using the project's protected request path. */
import { fetchHtmlForHealing } from '../../../src/engine/runner.js';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sources = [
  ['maiden', 'https://www.ironmaiden.com/tour/run-for-your-lives-north-american-tour-2027/'],
  ['bluetones', 'https://bluetones.band/live/'],
  ['matthew', 'https://www.princegeorge.ca/community-culture/arts-events/events-calendar/matthew-good-and-his-band-i-mother-earth'],
  ['eurocks-home', 'https://www.eurockeennes.fr/'],
  ['charrues', 'https://www.vieillescharrues.asso.fr/']
];
async function main() {
  const manifest: unknown[] = [];
  for (const [id, url] of sources) {
    const checkedAt = new Date().toISOString();
    try {
      const html = await fetchHtmlForHealing(url);
      await writeFile(`tests/fixtures/official-remaining-20261028/${id}.html`, html);
      manifest.push({ id, url, checkedAt, backend: 'axios', bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') });
      console.log(id, html.length);
    } catch (e) { manifest.push({ id, url, checkedAt, error: String(e) }); }
  }
  await writeFile('tests/fixtures/official-remaining-20261028/provenance.json', JSON.stringify(manifest, null, 2) + '\n');
}
void main();
