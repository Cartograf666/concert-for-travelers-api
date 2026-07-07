# Agent Task: Add Venue Scrapers (high-volume, low-complexity)

Your job: **add new venue scraper configs** to `scrapers/*.json`. The engine already
handles all the hard parts (fetch with retries, per-domain throttling, JSON-LD
fallback, self-healing, change-detection, dedup, publishing). Each venue you add is
**one JSON file** built from a template and verified with one command. This is
breadth work: repeat the recipe per venue, ship each one.

The service scrapes concert schedules from music venues, filters events down to a
curated artist list, and publishes a static JSON API. More venues = more coverage =
more value. There is effectively unlimited volume here (every venue in every city).

---

## 0. One-time setup: build the test helper

If `src/scripts/test_config.ts` does not exist, create it (this is what makes the
grind fast — it runs a single config and prints what it extracts):

```ts
// src/scripts/test_config.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { ScraperConfigSchema } from '../schemas/config.js';
import { runScraper } from '../engine/runner.js';

(async () => {
  const id = process.argv[2];
  if (!id) { console.error('usage: test-config <venue-id>'); process.exit(1); }
  const file = path.join(process.cwd(), 'scrapers', `${id}.json`);
  const config = ScraperConfigSchema.parse(JSON.parse(await fs.readFile(file, 'utf-8')));
  const res = await runScraper(config);
  console.log(res.success ? `OK — ${res.concerts.length} events extracted` : `FAIL (${res.reason}): ${res.error}`);
  console.log(JSON.stringify(res.concerts.slice(0, 6), null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
```

Add to `package.json` scripts: `"test-config": "tsx src/scripts/test_config.ts"`.

Run it with: `npm run test-config -- <venue-id>`

---

## 1. Per-venue recipe (~5 min each)

1. **Find the schedule URL** — the venue's agenda / events / "what's on" page that
   lists upcoming shows (not the homepage).
2. **Fetch it and inspect** (`curl -sL -A "Mozilla/5.0 ..." <url> | less`, or browser
   devtools). Decide the extraction type in this order of preference:
   - **JSON-LD** (best): search the HTML for `application/ld+json` containing
     `"@type":"MusicEvent"` / `"Event"`. If present → `type: "jsonld"`, no CSS
     selectors needed. Most durable (survives redesigns).
   - **Hydration JSON**: search for `id="__NEXT_DATA__"` (Next.js) or `__NUXT_DATA__`.
     If the events live in that blob → `type: "next_data"` with dot/bracket paths.
   - **Raw JSON API**: if the page is actually an XHR/JSON endpoint → `type: "json_api"`.
   - **CSS selectors** (last resort): `type: "static_selectors"`. Pick stable
     selectors (semantic tags, `id`, `data-*`, `itemprop`). **Avoid hashed CSS-in-JS
     classes** like `css-8tb23n` / `sc-1x2y3z` — they change on every deploy.
3. **Write the config** (see §2), save as `scrapers/<venue-id>.json`.
4. **Test**: `npm run test-config -- <venue-id>` → must extract ≥1 event with a real
   artist name and a date string.
5. **Commit** (see §5).

For a `static_selectors` config, the engine automatically tries JSON-LD if the
selectors match 0 — so selectors + JSON-LD is a safe combo, but prefer `jsonld`
outright when the site has it.

---

## 2. Config reference

Schema: `src/schemas/config.ts`. Shape:

```jsonc
{
  "id": "paradiso-amsterdam",          // unique, kebab-case: <venue>-<city>
  "domain": "paradiso.nl",             // bare domain
  "url": "https://www.paradiso.nl/en/agenda",  // http(s) only; NEVER localhost/private IPs
  "type": "static_selectors",          // static_selectors | jsonld | next_data | json_api | custom_js
  "maxRetries": 2,                     // optional (default 2)
  "requestDelayMs": 0,                 // optional; set >0 to be gentle on shared hosts
  "allowEmpty": false,                 // optional; true for seasonal venues that are legitimately empty sometimes
  "selectors": {
    "eventBlock": "li.event-card",     // REQUIRED: selector/path for one event
    "artist": "h3.title",              // artist text (omit for single-artist tour pages)
    "artistNameFallback": "",          // fixed artist name when the whole page is one act's tour
    "date": ".date",                   // REQUIRED: date text
    "datePattern": "",                 // optional hint, unused by parser today
    "ticketUrl": "a.tickets",          // optional: link
    "venue": "", "city": "", "country": "",  // optional per-row (for multi-venue/tour pages)
    "venueNameFallback": "Paradiso",   // REQUIRED
    "cityNameFallback": "Amsterdam",   // REQUIRED
    "countryNameFallback": "NL"        // REQUIRED: ISO 3166-1 alpha-2 (exactly 2 chars)
  }
}
```

**Type-specific notes:**
- `jsonld`: selectors are only used for `*Fallback` values; extraction reads
  schema.org events directly. You still must provide the three `*NameFallback`s.
- `next_data` / `json_api`: `eventBlock` is a path into the JSON (`props.pageProps.events`
  or `data.pages[0].events` — bracket indices supported). `artist`/`date`/`ticketUrl`
  are field paths within each event object.
- `custom_js`: only when nothing else works — write `src/engine/custom/<id>.ts`
  exporting `async function scrape(config, html, scrapedAt)`. High effort; avoid.

---

## 3. Testing & acceptance

- **Pass:** `npm run test-config -- <id>` prints `OK — N events` with N ≥ 1, and the
  sample rows show a plausible artist name + a date string.
- The printed `date` can be raw text (e.g. `"12 Okt 2026"`, `"2026-10-15"`,
  `"woensdag 08 juli 2026"`) — the pipeline normalizes it. Supported: ISO, `DD.MM[.YYYY]`,
  `D Month [YYYY]`, `Month D [YYYY]`, ranges, and EN/DE/NL/Serbian-Latin month names,
  plus a chrono-node fallback. If dates come out as unparseable garbage, fix the `date`
  selector (you're grabbing the wrong node).
- **Important — do not judge by published output.** The pipeline keeps only events
  whose artist is in `data/approved_artists.json`. A correct config can extract 50
  events yet publish 0 because none are approved. Judge the config by the **raw
  extracted count** from `test-config`, not by `dist/`.
- Do not run `npm run scrape` to test one venue (it runs all of them).

---

## 4. Pitfalls (verified — save yourself the time)

- **Hashed classes are traps.** `li.css-8tb23n` works today, breaks on the venue's
  next deploy. Prefer JSON-LD/next_data, or stable selectors (`article[id^=...]`,
  `[itemprop=...]`, semantic tags). Self-heal will patch breaks but don't lean on it.
- **Custom elements are real.** Some sites use non-standard tags (`<datetime>`,
  `<label>`); selectors like `a datetime` / `a label` are valid and work in cheerio.
- **Never point `url` at localhost, private IPs, or a test/mock page.** The schema
  rejects private/link-local/metadata hosts (SSRF guard), and fixtures pollute the
  live run. Real public venue URLs only.
- **`allowEmpty`** — only set `true` when a venue genuinely has gaps (seasonal club);
  otherwise 0 events is treated as a broken scraper and queued for self-heal.
- **Stale pages.** Some venues show past/last-season events. That's the site's data,
  not a bug — the config is still correct if it extracts them.

---

## 5. Commit / PR conventions

- One venue per commit (or a small city-batch), message: `feat(scrapers): add <venue> (<city>)`.
- End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Opening a PR that touches `scrapers/**` runs `pr-test.yml` (build + tests) — keep it green.
- Do **not** commit `data/approved_artists.json` from this task (it's owned by the
  enrichment workflows). Only touch `scrapers/` (and, once, the test helper +
  package.json).

---

## 6. Sourcing venues (the volume)

Target cities already covered — extend within and beyond them: **Amsterdam, Berlin,
Belgrade, Tbilisi, London**. Per city, mine venue schedule pages from:
- **Resident Advisor** (`ra.co`) — clubs/electronic.
- **Songkick / Bandsintown** — venue pages list upcoming shows and link to official sites.
- **City "what's on" / listings** sites and tourist boards.
- **Ticketing** aggregators (local Ticketmaster/See Tickets/etc.) — but prefer the
  venue's own site (more stable, richer JSON-LD).

Pick venues with an official schedule page. Aim for a steady stream: 10–20 venues per
city before moving on.

---

## 7. Scaling the grind

This parallelizes cleanly: one unit of work = one venue URL → one tested config.
A batch of 20–50 venues can be processed concurrently (one sub-agent per venue,
each given a URL, returning a tested `scrapers/<id>.json`). Keep each sub-agent's
scope to a single venue and the acceptance check in §3.

---

## Definition of done (per venue)

- `scrapers/<id>.json` exists and validates against the schema.
- `npm run test-config -- <id>` → `OK — N events` (N ≥ 1) with sane artist/date samples.
- Committed; PR (if used) green.
