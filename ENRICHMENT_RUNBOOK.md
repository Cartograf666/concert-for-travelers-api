# Artist Site Enrichment — Agent Runbook

Hand this file to any coding agent (Claude Code / Agent SDK) to continue enriching
`data/approved_artists.json` with each artist's official **website**, **tourUrl**
(page listing current dates + cities), **socials**, and to emit per-artist scraper
configs in `scrapers/artist-<slug>.json`.

The heavy lifting is done by a **swarm of research agents** launched via the `Workflow`
tool. A deterministic Node harness (`src/scripts/enrich_sites.ts`) selects work and
merges results. **Agents never write the DB** — only the harness does (single writer,
no races).

---

## 0. Preconditions

- Node v20+, run everything from the project root: `/Users/alex/code/сoncert-for-travelers-api`
- `npm install` already done.
- The `Workflow` tool must be available (multi-agent orchestration). If it isn't,
  you can't run the swarm — stop and tell the user.

Check progress any time:

```bash
npm run enrich-sites stats
```

Output shows `total`, `enriched`, `with website`, `with tourUrl`, `remaining`.
Enrichment is **resumable**: an artist is "done" once it has an `enrichedAt` field,
so `select` always hands out the next un-done names. Safe to stop/restart anytime.

---

## 1. The loop (repeat until `remaining` == 0)

### Step 1 — pick the next chunk

```bash
npm run enrich-sites select 100 /tmp/chunk.json
```

Writes the next 100 un-enriched artist names to `/tmp/chunk.json` (a JSON array of strings).
Pick 60–150 per chunk. Bigger = fewer runs but longer wall-clock (see §4).

### Step 2 — build the swarm script with those names embedded

⚠️ **Known gotcha:** in this runtime the `Workflow` tool's `args` parameter arrives
empty. So you must **embed the names directly in the script** as `const NAMES = [...]`.
Read `/tmp/chunk.json`, paste its array into the template below.

Write this to a file, e.g. `/tmp/enrich-chunk.js`:

```javascript
export const meta = {
  name: 'artist-site-enrichment',
  description: 'Swarm: find official website, tour/dates page, socials + scraper config per artist',
  phases: [
    { title: 'Research', detail: 'web-research each artist batch for site/tour/socials' },
    { title: 'Verify', detail: 'adversarially confirm domains truly belong to the artist' }
  ]
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['name', 'website', 'tourUrl', 'socials', 'scraper', 'confidence'],
    properties: {
      name: { type: 'string' },
      website: { type: ['string', 'null'] },
      tourUrl: { type: ['string', 'null'] },
      socials: { type: 'object', additionalProperties: false,
        required: ['spotify','instagram','facebook','youtube','telegram','vk'],
        properties: {
          spotify: { type: ['string','null'] }, instagram: { type: ['string','null'] },
          facebook: { type: ['string','null'] }, youtube: { type: ['string','null'] },
          telegram: { type: ['string','null'] }, vk: { type: ['string','null'] } } },
      scraper: { type: ['object','null'], additionalProperties: false,
        required: ['domain','url','type','selectors'],
        properties: {
          domain: { type: 'string' }, url: { type: 'string' },
          type: { type: 'string', enum: ['static_selectors','json_api'] },
          selectors: { type: 'object', additionalProperties: false,
            required: ['eventBlock','artistNameFallback','date','venueNameFallback','cityNameFallback','countryNameFallback'],
            properties: {
              eventBlock: { type: 'string' }, artistNameFallback: { type: 'string' },
              date: { type: 'string' }, city: { type: ['string','null'] },
              venue: { type: ['string','null'] }, country: { type: ['string','null'] },
              ticketUrl: { type: ['string','null'] }, venueNameFallback: { type: 'string' },
              cityNameFallback: { type: 'string' }, countryNameFallback: { type: 'string' } } } } },
      confidence: { type: 'string', enum: ['high','medium','low'] }
    }
  } } }
}

// >>> PASTE the array from /tmp/chunk.json here <<<
const NAMES = ["Example Artist A", "Example Artist B"]

const BATCH = 6
const batches = []
for (let i = 0; i < NAMES.length; i += BATCH) batches.push(NAMES.slice(i, i + BATCH))
log(`Enriching ${NAMES.length} artists in ${batches.length} batches of up to ${BATCH}`)

const researchPrompt = (batch) => `You are a meticulous music-industry data researcher. For EACH artist/band below, find their real, current concert information sources. Use WebSearch and WebFetch (if not directly available, load them first via ToolSearch with query "select:WebSearch,WebFetch").

Artists:
${JSON.stringify(batch, null, 2)}

For each artist return:
- website: the artist's OWN official website (a domain they control, or official label/management site). NOT ticketmaster, songkick, bandsintown, setlist.fm, wikipedia, spotify, youtube, a fan site, or a store. null if none.
- tourUrl: the exact page listing UPCOMING concert dates with cities (commonly /tour, /shows, /live, /concerts, /dates, /events). Open it, confirm it currently shows dated shows with city names. Prefer a page on the official site; if dates are only in an embedded Bandsintown/Songkick widget, still return the tour page URL but set scraper=null. null if none.
- socials: official profile URLs for spotify, instagram, facebook, youtube, telegram, vk. null for any you can't confirm official.
- scraper: ONLY set (non-null) if you actually FETCHED the tourUrl and it is static, server-rendered HTML with repeating event rows you can target with CSS selectors. Then provide: domain (host of tourUrl), url (=tourUrl), type ("static_selectors"), selectors.eventBlock (one repeating show row), selectors.artistNameFallback (the artist's exact name), selectors.date, selectors.city/venue/country (per-row selectors or null), selectors.ticketUrl (or null), selectors.venueNameFallback/cityNameFallback ("" when per-row selector exists), countryNameFallback (2-letter ISO best guess). If JS-rendered, a widget, or unsure of selectors, set scraper=null. A null scraper beats guessed selectors.
- confidence: "high" only if you opened the site and tour page and are certain; else "medium"/"low".

Be truthful. Never invent a URL. Return null rather than guess. Output every artist exactly once, using the exact input name.`

const verifyPrompt = (found) => `You are an adversarial fact-checker for a music concert database. REFUTE anything wrong.

Records:
${JSON.stringify(found, null, 2)}

For each, use WebSearch/WebFetch (load via ToolSearch "select:WebSearch,WebFetch" if needed):
- Does the website resolve and belong to THIS artist (not a namesake/fan page/reseller/parked domain)? If not clearly official, set null.
- Does the tourUrl show this artist's upcoming dates with cities right now? If it 404s, is unrelated, or has no dates, set null (and scraper null).
- Are socials the official accounts for THIS artist? Null any wrong/unverifiable.
- Is scraper safe? If you can't confirm the tour page is static HTML with the claimed rows, set scraper null.
Keep every artist, exact same name. Return corrected records.`

const out = await pipeline(
  batches,
  (batch, _o, i) => agent(researchPrompt(batch), { label: `research:b${i+1}`, phase: 'Research', agentType: 'general-purpose', schema: RESULT_SCHEMA }),
  (research, _b, i) => (research && research.results)
    ? agent(verifyPrompt(research.results), { label: `verify:b${i+1}`, phase: 'Verify', agentType: 'general-purpose', schema: RESULT_SCHEMA })
    : { results: [] }
)

const merged = out.filter(Boolean).flatMap(r => (r && r.results) ? r.results : [])
log(`Done: ${merged.length} records | website:${merged.filter(r=>r.website).length} tourUrl:${merged.filter(r=>r.tourUrl).length} scraper:${merged.filter(r=>r.scraper).length}`)
return { count: merged.length, results: merged }
```

### Step 3 — run the swarm

Invoke the `Workflow` tool with `{ scriptPath: "/tmp/enrich-chunk.js" }`.
It runs in the background; you get a task-completion notification with a `Task ID`
and an `output-file` path. **Do not busy-poll** — wait for the notification.

Rough timing: ~6 min per batch of 6 (research + verify). 100 artists ≈ 17 batches;
concurrency is capped at ~16 agents, so expect a long run. See §4.

### Step 4 — apply results to the DB

The task output file is NOT valid `.json` on its own — it's a wrapper. Extract
`.result.results` and hand that array to `apply`:

```bash
OUT="<output-file path from the notification>"
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.env.OUT,'utf8'));fs.writeFileSync('/tmp/results.json',JSON.stringify(d.result.results,null,2));console.log('extracted',d.result.results.length)"
npm run enrich-sites apply /tmp/results.json
```

`apply` merges `website`/`tourUrl`/`socials` into the DB, sets `enrichedAt`, and writes
`scrapers/artist-<slug>.json` for any record whose `scraper` block passes Zod validation
(invalid/guessed configs are skipped with a logged reason — the DB enrichment still lands).

### Step 5 — verify, then repeat

```bash
npm run enrich-sites stats      # remaining should have dropped by the chunk size
npm test                        # runner tests still green
```

Go back to Step 1 for the next chunk.

---

## 2. Optional: back up before each apply

```bash
cp data/approved_artists.json /tmp/db.backup.$(date +%s).json
```

`apply` only mutates entries named in the results file and is idempotent per name,
but a backup is cheap insurance.

---

## 3. What "good data" looks like

- `website` = artist-controlled domain (e.g. `https://www.thecure.com/`). Rejects
  resellers/aggregators/wikipedia.
- `tourUrl` = a page that *currently* lists dated shows with cities.
- `scraper` present only for **static HTML** tour pages (many big acts use JS widgets →
  `scraper: null` but `tourUrl` still recorded). Example that produced a config: The Cure,
  Sabaton. Runtime selector correctness is later checked by `npm run scrape`; broken
  selectors get auto-fixed by the existing self-healing flow (`npm run heal`).

---

## 4. Throughput & tuning

- `total` = 62,778. Run 1 did 23 in ~26 min with 8 agents (~600k tokens).
- Levers in the script: `BATCH` (artists per agent — raise to 10–15 for fewer/slower
  agents), or drop the verify stage (≈2× faster, more hallucinated domains slip through).
- Workflow caps: ~16 concurrent agents, 1000 agents per single run. So one run can cover
  at most ~`1000 * BATCH / 2` artists (÷2 for the verify stage). Keep chunks well under that.
- Realistically this is many hours of agent time across many sessions. Consider the `/loop`
  skill to auto-run chunks unattended.

---

## 5. Files involved

- `src/scripts/enrich_sites.ts` — the harness (`npm run enrich-sites <select|apply|stats>`).
- `src/schemas/config.ts`, `src/engine/runner.ts` — engine extended for artist tour pages
  (optional `artist`, `artistNameFallback`, per-row `venue`/`city`/`country`; per-row wins,
  else fixed fallback). Backward-compatible with venue configs.
- `data/approved_artists.json` — the 62k catalog being enriched.
- `scrapers/artist-*.json` — generated per-artist scraper configs.
- `tests/runner.test.ts` — includes the artist-tour-page test.
