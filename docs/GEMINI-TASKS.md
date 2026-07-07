# GEMINI WORK BRIEF — concert-for-travelers-api

You are a fast worker on this TypeScript repo. You do **high-volume, mechanical**
work: adding venue scraper configs, plus a short list of **exactly-specified** small
code fixes. You do NOT do design, security, or anything needing judgment.

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

## TASK A — add venue scrapers (MAIN JOB, do this most)

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

## TASK B — safe small code fixes (do each ONCE, exactly as written)

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
- `id` regex hardening / path-traversal in config.ts, repair.ts, heal.ts, runner.ts (SECURITY)
- SSRF: redirects, IP encodings, Playwright host guard (SECURITY)
- self-heal auto-merge verification / prompt fencing (SECURITY)
- artist matcher tiers / MIN_SUBSTRING_COVERAGE / fuzzy / inverted index (needs judgment)
- parseDate date-fabrication fixes (bare time, Date.parse fallback) (needs judgment)
- SQLite migration of approved_artists.json (architecture)
- removing the second processConcerts pass (orchestrator logic)

---

## WHEN DONE — write a short report:
- Venues added (ids).
- Fixes applied (B1–B5) with commit hashes.
- Anything skipped and why.
- Anything that went red you couldn't fix.
