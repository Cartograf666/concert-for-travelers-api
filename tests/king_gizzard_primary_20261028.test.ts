import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { loadConfigs } from '../src/engine/runner.js';
import { scrape as radiant } from '../src/engine/custom/artist-king-gizzard-radiant.js';
import { scrape as apollo } from '../src/engine/custom/artist-king-gizzard-apollo.js';
import { scrape as sequoie } from '../src/engine/custom/artist-king-gizzard-sequoie.js';
const at = '2026-10-28T00:00:00.000Z';
const cases = [
  { id: 'radiant', parse: radiant, day: '2027-06-09', city: 'Caluire et Cuire', country: 'FR' },
  { id: 'apollo', parse: apollo, day: '2027-06-20', city: 'London', country: 'GB' },
  { id: 'sequoie', parse: sequoie, day: '2027-06-11', city: 'Bologna', country: 'IT' }
];
test('King primary parsers retain exact day/location and source action distinctions; reject identity/date/cancellation changes', async () => {
  const configs = await loadConfigs('scrapers/artists');
  for (const source of cases) {
    const config = configs.find(c => c.id === `artist-king-gizzard-${source.id}`)!;
    assert.ok(config);
    const html = await readFile(`tests/fixtures/official-remaining-20261028/king-${source.id}.html`, 'utf8');
    const result = await source.parse(config, html, at);
    assert.deepEqual(result.map(r => [r.artist,r.date,r.city,r.country]), [['King Gizzard & The Lizard Wizard',source.day,source.city,source.country]]);
    assert.ok(result[0].ticketUrl && result[0].ticketUrl !== config.url);
    assert.equal(result[0].eventUrl, source.id === 'sequoie' ? undefined : config.url);
    assert.deepEqual(await source.parse(config, '', at), []);
    assert.deepEqual(await source.parse(config, '<script type="application/ld+json">{broken</script>', at), []);
    const $ = cheerio.load(html);
    $('h1,h2').each((_, el) => { if (/gizzard/i.test($(el).text())) $(el).text('Unrelated performer'); });
    assert.deepEqual(await source.parse(config, $.html(), at), []);
    const invalid = source.id === 'radiant' ? html.replaceAll('09 juin 2027','31 juin 2027')
      : source.id === 'apollo' ? html.replaceAll('Sunday 20th June 2027','Sunday 31st June 2027')
      : html.replaceAll('11 GIUGNO','31 GIUGNO');
    assert.deepEqual(await source.parse(config, invalid, at), []);
    const cancelled = cheerio.load(html);
    if (source.id === 'radiant') cancelled('.spectacle-main-center').prepend('<p>Spectacle annulé</p>');
    else if (source.id === 'apollo') cancelled('h1.event-hero__title').parent().prepend('<p>Event postponed</p>');
    else cancelled('h2').each((_, el) => { if (/gizzard/i.test(cancelled(el).text())) cancelled(el).prepend('ANNULLATO '); });
    assert.deepEqual(await source.parse(config, cancelled.html(), at), []);
  }
});
