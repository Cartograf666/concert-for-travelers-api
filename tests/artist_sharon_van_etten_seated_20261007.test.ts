import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scrape } from '../src/engine/custom/artist-you-used-to-hold-me-so-tight.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

async function input() {
  const [source, captured] = await Promise.all([
    readFile('scrapers/artist-you-used-to-hold-me-so-tight.json', 'utf8'),
    readFile('tests/fixtures/artist-sharon-van-etten-seated-empty-20261007.json', 'utf8')
  ]);
  return { config: ScraperConfigSchema.parse(JSON.parse(source)),
    captured: JSON.parse(captured) as Record<string, any> };
}

test('captured official Seated identity and explicit empty relationship certify zero', async () => {
  const { config, captured } = await input();
  assert.equal(config.type, 'custom_js');
  assert.equal(config.allowEmpty, true);
  assert.equal(config.id, 'artist-you-used-to-hold-me-so-tight');
  assert.deepEqual(await scrape(config, JSON.stringify(captured), '2026-10-07T12:00:00Z'), []);
  const includedEmpty = structuredClone(captured);
  includedEmpty.included = [];
  assert.deepEqual(await scrape(config, JSON.stringify(includedEmpty), '2026-10-07T12:00:00Z'), []);
});

test('blank, malformed, unrelated or contradictory feeds cannot certify empty', async () => {
  const { config, captured } = await input();
  for (const body of ['', '<html>blocked</html>', '{}', 'null']) {
    await assert.rejects(scrape(config, body, '2026-10-07T12:00:00Z'));
  }
  for (const change of [
    (f: any) => { f.data.id = '00000000-0000-0000-0000-000000000000'; },
    (f: any) => { f.data.type = 'artists'; },
    (f: any) => { f.data.attributes.name = 'Another artist'; },
    (f: any) => { delete f.data.relationships['tour-events']; },
    (f: any) => { f.included = [{ id: 'c273ebde-730b-4ece-89b2-830d6fc46ddd', type: 'tour-events' }]; },
    (f: any) => { f.included = null; }
  ]) {
    const feed = structuredClone(captured);
    change(feed);
    await assert.rejects(scrape(config, JSON.stringify(feed), '2026-10-07T12:00:00Z'));
  }
  await assert.rejects(scrape({ ...config, url: 'https://cdn.seated.com/api/tour/other' },
    JSON.stringify(captured), '2026-10-07T12:00:00Z'), /source URL/);
});

test('populated group feed fails closed until canonical catalog identity is resolved', async () => {
  const { config, captured } = await input();
  const feed = structuredClone(captured);
  feed.data.relationships['tour-events'].data = [{
    id: 'c273ebde-730b-4ece-89b2-830d6fc46ddd', type: 'tour-events'
  }];
  feed.included = [{
    id: 'c273ebde-730b-4ece-89b2-830d6fc46ddd', type: 'tour-events',
    attributes: { 'starts-at-date-local': '2026-11-14', 'venue-name': 'The Wiltern',
      'formatted-address': 'Los Angeles, CA' }
  }];
  await assert.rejects(scrape(config, JSON.stringify(feed), '2026-10-07T12:00:00Z'),
    /canonical group identity is pending/);
});
