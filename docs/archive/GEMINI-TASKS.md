> **ARCHIVED 2026-07-21.** Task A/B/C below are all done or superseded (Task C's
> artist tour-page scraper population, and the sharding it references, both
> shipped). `data/approved_artists.json` (referenced throughout below) no
> longer exists -- replaced by `data/artists/shard-0.json`..`shard-7.json`.
> Kept for historical reference only. Current status lives in `BACKLOG.md`;
> hand a fresh, self-contained task doc to any future Gemini/agent session
> instead of reviving this one.

# GEMINI WORK BRIEF — concert-for-travelers-api

You are a fast worker on this TypeScript repo. You do **high-volume, mechanical**
work: adding artist tour-page scraper configs (Task C, current priority), venue scraper
configs (Task A), plus a short list of **exactly-specified** small code fixes (Task B,
already done). You do NOT do design, security, or anything needing judgment.

## GOLDEN RULES — never break these
1. After EVERY change run BOTH: `npm test` and `npx tsc --noEmit`. Both must be green
   BEFORE you commit. If either goes red and you can't trivially fix it, **revert your
   change** and move on. Never commit red.
2. **One small commit per task.** End every commit message with exactly:
   `Co-Authored-By: Gemini <noreply@google.com>`
3. **NEVER touch:** `data/approved_artists.json`, `.github/workflows/*` secrets, or
   anything in the "DO NOT TOUCH" list at the bottom.
4. If code doesn't match what a task describes, or you're unsure — **SKIP it**, write a
   line in your final NOTES, move on. **Do not guess on code.**
5. Scraper `url` must be a real public venue page. NEVER localhost / private IP / a test
   page. NEVER try to bypass Cloudflare — if a venue is Cloudflare-blocked or its domain
   is dead, skip it and note it.

---

## TASK C — add artist tour-page scrapers (NEW MAIN JOB — prioritize this over Task A)

**Why this exists:** venue scrapers and the Ticketmaster sweep only cover markets/venues
we already know about (mostly Europe/North America). A user noticed a real gap live: The
Weeknd showed up for Singapore but not Japan, not because of a bug, but because neither
data source has real presence in Japan. The actual fix for "give me every concert for MY
artists, wherever they play" is a scraper keyed by ARTIST instead of by venue/country —
their own official tour page, or (if their site embeds one) the public Bandsintown/
Songkick widget on their site. That's a normal public webpage load, not a gated developer
API — same legitimacy as scraping any other page in this repo.

**The list:** `data/artist_scrape_targets.txt`, one artist/band name per line, ~1400
entries (mix of English and Russian names — go through all of them, in order). Some
entries are noise (genre tags, stray words like "билборды", not real artists) — if a name
doesn't clearly identify a real touring act, SKIP it and note it, don't guess.

**Config location is different from Task A:** artist configs go in `scrapers/artists/`
(not the top-level `scrapers/` dir) — this is deliberate, they run on their own weekly
schedule (`artist-scrape.yml`), not the daily one, so there's no time-budget pressure like
Task A's venues have. `npm run test-config -- <id>` already checks both locations, no
extra step needed.

**Resumability:** each artist becomes exactly one file, `scrapers/artists/<artist-slug>-tour.json`.
Before working an artist, check whether that file already exists — if so, skip it (already
done, whether by you or a prior session). This makes the whole list safely resumable
across sessions/restarts with no separate progress-tracking file needed.

**Per artist:**
1. Take the next artist from the list whose `scrapers/artists/<slug>-tour.json` doesn't
   exist yet.
2. Find their real official tour/dates page: try `<official-site>/tour`, `/shows`,
   `/live`, `/events` first. If their own site has no tour listing but embeds a
   Bandsintown or Songkick widget, that's a valid source too.
3. Fetch it, choose `type` in the SAME preference order as Task A: `jsonld` > `next_data`
   > `json_api` > `static_selectors` (last resort, if the page needs JS rendering to show
   events, use `playwright_render` instead of giving up).
4. Write `scrapers/artists/<artist-slug>-tour.json`. Same schema/template as Task A's
   venue configs (see below) EXCEPT there is no fixed venue/city — if the tour page lists
   multiple cities/venues across the artist's tour, that's fine, the engine handles
   multiple events per scraper already; set `venueNameFallback`/`cityNameFallback` only if
   the page doesn't reliably supply its own per-event venue/city (leave them off the
   selectors and let the real page data flow through if it has it).
5. Test: `npm run test-config -- <artist-slug>-tour` → must print `OK — N events` with
   N≥1 and a real date. If it fails or the artist has no accessible public tour listing
   anywhere (no official site, no widget, nothing) — SKIP and note it, do not fabricate a
   config that doesn't actually work. (A fabricated scraper that always 0-events or
   ENOTFOUNDs was already caught and removed once this session — don't repeat that.)
6. `npm test && npx tsc --noEmit` green → commit `feat(scrapers): add <artist> tour page`.

Work through the list in order. This is high-volume, same as Task A — keep going.

---

## TASK A — add venue scrapers (do this if Task C is fully worked through)

Full recipe: `docs/ADD-VENUE-SCRAPERS.md`. Read it once. Then repeat this loop:

**Step 0 (once):** if `src/scripts/test_config.ts` doesn't exist, create it from the
code in `docs/ADD-VENUE-SCRAPERS.md` §0 and add `"test-config": "tsx src/scripts/test_config.ts"`
to package.json scripts. Commit `chore: add test-config helper`.

**Per venue:**
1. Find a real music venue with a public schedule/agenda URL. Cities to cover:
   Amsterdam, Berlin, Belgrade, Tbilisi, London (then any others).
2. Fetch it. Choose `type` in this order:
   - `"jsonld"` — page has `<script type="application/ld+json">` with `"@type":"MusicEvent"`/`"Event"`. Best. No CSS needed.
   - `"next_data"` — page has `id="__NEXT_DATA__"`; put JSON paths in selectors.
   - `"static_selectors"` — pick STABLE CSS selectors. **Avoid hashed classes** like `css-8tb23n`.
3. Write `scrapers/<venue>-<city>.json` using the template below.
4. Test: `npm run test-config -- <venue>-<city>` → must print `OK — N events` with N≥1
   and sane artist + date in the samples. If it fails, fix the selectors/type or skip
   the venue (note it).
5. `npm test && npx tsc --noEmit` green → commit `feat(scrapers): add <venue> (<city>)`.

**Template:**
```json
{
  "id": "paradiso-amsterdam",
  "domain": "paradiso.nl",
  "url": "https://www.paradiso.nl/en/agenda",
  "type": "jsonld",
  "selectors": {
    "eventBlock": "",
    "date": "",
    "venueNameFallback": "Paradiso",
    "cityNameFallback": "Amsterdam",
    "countryNameFallback": "NL"
  }
}
```
Rules for the config: `id` must match `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens
only — NO slashes, dots, or `..`). `countryNameFallback` is exactly 2 letters (ISO code).
For `static_selectors`, `eventBlock`/`date` are required and `artist` is usually needed.

Keep going — this is your main output. Aim for many venues.

---

## TASK B — safe small code fixes (DONE — B1 through B5 all landed and verified, nothing left to do here)

For EACH: make the change → add/adjust its test → `npm test && npx tsc --noEmit` green →
commit. If the file/code doesn't look like the description, SKIP and note it.

**B1 — fold accented city names in slugify** (`src/pipeline/process.ts`)
In the `slugify` function, add `.normalize('NFKD').replace(/[̀-ͯ]/g, '')`
immediately after `.toLowerCase()` (before the existing `.replace(...)` cleanup).
Add a test (in the pipeline test file): `assert.strictEqual(slugify('Zürich'), slugify('Zurich'))`.
Commit `fix: normalize diacritics in slugify to dedupe cross-source cities`.

**B2 — stop wiping socials on merge** (`src/pipeline/enrich.ts`)
Find where enrichment results are merged into an existing artist entry (near where
`website` is set with `entry.website || existing.website || null`). Change the `socials`
build so each field is OR-preserved the same way, for every key
(spotify, instagram, facebook, youtube, telegram, vk):
`spotify: entry.socials?.spotify || existing.socials?.spotify || null` (and same pattern
for the other 5 keys). Add a test: existing entry has `socials.spotify` set, the new
result has `socials: {}`, assert the spotify value still survives after merge.
Commit `fix: preserve existing socials when a later enrichment returns none`.

**B3 — make closeBrowser crash-safe** (`src/engine/runner.ts`)
In `closeBrowser()`, capture and null the promise BEFORE awaiting, and never throw:
```ts
const p = browserPromise;
browserPromise = null;
if (p) { try { const b = await p; await b.close(); } catch (e) { console.warn('[Runner] browser close failed:', (e as any)?.message); } }
```
In `getBrowser()`, make a failed launch retryable: attach `.catch(() => { browserPromise = null; })`
to the stored promise (so a rejected launch is not cached forever). Keep behavior otherwise
identical. `npm test && npx tsc --noEmit` must pass. Commit `fix: crash-safe browser cleanup and retryable launch`.

**B4 — fail fast on dead domains** (`src/engine/runner.ts`)
In `isRetryableError`, remove `'ENOTFOUND'` from the set of retryable error codes (an
unresolvable domain should NOT be retried). Change nothing else. Commit `fix: do not retry ENOTFOUND (dead domain)`.

**B5 — publish output polish** (`src/generator/publish.ts`)
Three changes: (a) remove the `, null, 2` pretty-print argument from the `JSON.stringify`
of the PUBLISHED files (artist files, city files, concerts.json, index.json) so they're
compact; (b) run the per-artist and per-city file writes with `await Promise.all(...)`
instead of sequential awaits; (c) sort the `concerts.json` array by `date`, then `artist`,
then `city` before writing. Commit `perf: compact + parallel + deterministic published JSON`.

---

## DO NOT TOUCH — leave for a human / smart agent. Just list them in NOTES, do NOT attempt:
- `src/run.ts`, `src/run-artists.ts`, `.github/workflows/artist-scrape.yml`,
  `.github/workflows/daily-scrape.yml` (orchestration/CI plumbing, already wired up for Task C)
- `data/artist_scrape_targets.txt` (read from it, never edit it)
- `id` regex hardening / path-traversal in config.ts, repair.ts, heal.ts, runner.ts (SECURITY)
- SSRF: redirects, IP encodings, Playwright host guard (SECURITY)
- self-heal auto-merge verification / prompt fencing (SECURITY)
- artist matcher tiers / MIN_SUBSTRING_COVERAGE / fuzzy / inverted index (needs judgment)
- parseDate date-fabrication fixes (bare time, Date.parse fallback) (needs judgment)
- SQLite migration of approved_artists.json (architecture)
- removing the second processConcerts pass (orchestrator logic)

---

## WHEN DONE — write a short report:
- Artist tour scrapers added (ids) and how many of the ~1400 are left.
- Venues added (ids), if you got to Task A.
- Anything skipped and why (bad/no tour page, ambiguous non-artist entry, etc).
- Anything that went red you couldn't fix.
