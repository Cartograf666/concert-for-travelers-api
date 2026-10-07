import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { runScraper, closeBrowser } from '../src/engine/runner.js';
import { ScraperConfigSchema } from '../src/schemas/config.js';

test('Limahl rendered source scopes events to Upcoming Events and accepts only its visible empty notice', async t => {
  const [configText, html] = await Promise.all([
    readFile('scrapers/artists/artist-limahl.json', 'utf8'),
    readFile('tests/fixtures/artist-limahl-official-empty-20261007.html', 'utf8')
  ]);
  const config = ScraperConfigSchema.parse(JSON.parse(configText));
  assert.equal(config.type, 'playwright_render');
  assert.equal(config.allowEmpty, true);
  assert.equal(config.emptyScheduleText, 'No upcoming events scheduled yet. Stay tuned!');
  const $ = cheerio.load(html);
  assert.equal($('ul.concerts-list li.event').length, 1, 'fixture retains an old Past Events row');
  assert.equal($(config.selectors!.eventBlock).length, 0, 'archive row must not match upcoming selector');

  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url === '/challenge') {
      res.end('<title>Security Verification</title><div class="widget iron_widget_events"><h3 class="widgettitle">Upcoming Events</h3><ul id="post-list" class="concerts-list"><li class="nothing-found">Security Verification</li></ul></div>');
    } else if (req.url === '/populated') {
      const page = cheerio.load(html);
      const widgets = page('div.iron_widget_events');
      const future = widgets.eq(1).find('li.event').first().clone();
      future.find('.event-line-node').first().text('28th May 2027');
      widgets.eq(0).find('li.nothing-found').remove();
      widgets.eq(0).find('ul.concerts-list').append(future);
      res.end(page.html());
    } else {
      res.end(html);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await closeBrowser();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const empty = await runScraper({ ...config, url: `${baseUrl}/empty` });
  assert.equal(empty.success, true, empty.error);
  assert.equal(empty.reason, 'empty_schedule');
  assert.equal(empty.concerts.length, 0);

  const populated = await runScraper({ ...config, url: `${baseUrl}/populated` });
  assert.equal(populated.success, true, populated.error);
  assert.equal(populated.concerts.length, 1, 'future Upcoming row parses, archived Past row remains excluded');
  assert.equal(populated.concerts[0].date, '28th May 2027');

  const challenge = await runScraper({ ...config, url: `${baseUrl}/challenge` });
  assert.equal(challenge.success, false);
  assert.notEqual(challenge.reason, 'empty_schedule');
});
