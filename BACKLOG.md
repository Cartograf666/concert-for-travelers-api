# Backlog

Living backlog for the concert-data API. Backend/data-only repo — a separate
app (`concerts-for-travelers`) consumes the published JSON.

**North-star user flow (consumer app):**
User adds the artists they love → enters vacation date windows → app returns
which concerts they can attend, and where. This repo's job is to feed that flow
with data rich enough to (1) **match** the user's artists reliably, (2) **place**
each concert in space and time, and (3) **rank** the options.

Legend: ✅ done · 🚧 in progress · ⬜ planned · 💡 idea

---

## ✅ Done

- **Concert sources**: venue scrapers (91 configs), Ticketmaster (27 countries),
  Bandsintown (artist-keyed, worldwide — covers Asia/Japan and RU artists),
  Eventbrite (artist-keyed, US discovery-page scrape).
- **Static JSON API on GitHub Pages**: `concerts.json`, `artists/{slug}.json`,
  `cities/{slug}.json`, `index.json`, `status.json`, dashboard `index.html`.
- **Per-concert data**: artist, artistWebsite, artistSocials (spotify/instagram/
  facebook/youtube/telegram/vk), date (YYYY-MM-DD), venue, city, country (ISO2),
  lat/lng (optional), ticketUrl, originalSource, scrapedAt.
- **Self-healing scrapers**: broken CSS selectors auto-repaired via Gemini,
  validated, PR'd, and squash-merged with no human gate. JSON-LD fast-path before
  ever calling the LLM.
- **Artist whitelist DB**: ~63.5k artists, tiered name-matching (exact → cover/
  tribute filter → coverage-guarded substring → fuzzy). Socials on ~27k, enriched
  via MusicBrainz (2.7k) + Wikidata-bulk (23.6k).
- **Self-growing target list**: `discover-artists` (weekly) pulls live charts →
  Deezer + Last.fm (+738 worldwide). Target list 1424 → 2204. Spotify dropped
  (free tier blocks Web API).
- **Multi-key Gemini failover**: rotate to the next key
  (`GEMINI_API_KEY`, `_RESERV1/2`, `_2.._10`, `GEMINI_API_KEYS`) once every model
  on the current key is quota/auth-exhausted. Covers enrich + self-heal + run.
  → `src/engine/gemini_keys.ts`.
- **Canonical artist IDs on every concert: `spotifyId` + `mbid`.** `spotifyId`
  parsed from `artistSocials.spotify` (no Spotify API call); `mbid` captured from
  MusicBrainz (`enrich_auto.ts`) and Wikidata's P434 claim (both per-artist and
  the bulk SPARQL pass), plus a one-off `backfill_mbid.ts` that retrofits `mbid`
  for artists already enriched before this field existed. →
  `src/schemas/concert.ts`, `src/pipeline/process.ts`, `src/scripts/enrich_auto.ts`,
  `src/scripts/enrich_wikidata_bulk.ts`, `src/scripts/backfill_mbid.ts`.
- **Guaranteed geocoding.** `src/pipeline/geocode.ts`: fills lat/lng for any
  concert missing them (mainly per-row artist tour-page venues), via a persistent
  cache keyed by venue+city+country so a repeat venue costs one Nominatim lookup
  ever, capped per run and deferring the rest to the next run. Deliberately kept
  outside `processConcerts` (which stays network-free and unit-testable) — wired
  into `run.ts` as its own best-effort step. Schema field stays optional by
  design: a hard requirement would mean one unresolvable venue name breaks the
  whole publish. → `src/pipeline/geocode.ts`, `src/run.ts`.
- **Genres + popularity + artist image.** `src/scripts/enrich_metadata.ts`: one
  Last.fm `artist.getInfo` call per artist yields both top tags (genres) and
  listener/playcount stats (needs a free `LASTFM_API_KEY`, gracefully skipped
  without one — same convention as `discover_artists.ts`); Deezer artist search
  (keyless) supplies an image, only trusted on an exact normalized name match.
  Own pending-gate (`metaEnrichedAt`/`metaTriedAt`), independent of the identity
  enrichment tiers, since most of the whitelist is already `enrichedAt` there.
  *Scope trim:* Ticketmaster-attraction-image fallback was skipped — Deezer's
  keyless artist search already covers the vast majority of real touring acts,
  and wiring TM's per-event image into a DB write from inside the daily scrape
  run would add real coupling for little marginal coverage. Scheduled via
  `.github/workflows/enrich-metadata.yml` (cron, checkpointed, same shape as
  `enrich-auto.yml`), also runnable manually with `npm run enrich-metadata [N]`.
  → `src/scripts/enrich_metadata.ts`.
- **`dist/artists.json` full artist catalog.** Publishes the *entire* whitelist
  (not just artists with a current concert), keyed by the same slug the
  per-artist concert files use, with name/website/socials/spotifyId/mbid/genres/
  popularity/image when known. Fixes the gap where `index.json` only listed
  artists that already had a scraped concert, so the consumer app's "add artists
  you love" autocomplete had no way to see the other ~60k whitelisted artists. →
  `src/generator/publish.ts` (`publishArtistCatalog`), wired into `src/run.ts`.
- **Event `startTime`.** HH:MM, populated from Ticketmaster's `localTime`,
  Bandsintown's ISO datetime, and any source whose date string embeds an ISO
  time (e.g. JSON-LD `startDate`). Deliberately does *not* add a second
  chrono-node pass over free-text scraper dates (cost vs. benefit) — see the
  docstring on `extractTimeFromRawDate`. → `src/schemas/concert.ts`,
  `src/pipeline/process.ts`, `src/engine/ticketmaster.ts`, `src/engine/bandsintown.ts`.
- **Venue kind.** Keyword-based classifier
  (`stadium`/`arena`/`club`/`theatre`/`hall`/`open-air`/`other`) applied to every
  concert's venue name uniformly across all sources, instead of per-source
  special-casing. → `src/pipeline/process.ts` (`inferVenueKind`).
- **Festival awareness.** Ticketmaster events with more than one
  `_embedded.attractions` entry are treated as a multi-artist bill: `festival
  {name, url}` + `lineup[]` (other acts on the bill). *Scope trim:* venue-scraper
  festival detection wasn't attempted — there's no generic signal for it in a
  scraped page the way TM's attractions array gives for free; would need
  per-scraper-config additions, a separate and much larger piece of work. →
  `src/schemas/concert.ts`, `src/engine/ticketmaster.ts`, `src/pipeline/process.ts`.
- **`slugify()` Unicode fix.** Pre-existing bug, surfaced by load-testing the new
  `dist/artists.json` catalog against the real whitelist at full scale: a
  non-Latin-only name (Cyrillic, CJK, ...) was stripped to an empty string by an
  ASCII-only `\w` filter, colliding 91/63,490 artists into one file/slug (374
  distinct collision groups, 758 names, once counting partial mangling too).
  Now Unicode-aware (`\p{L}`/`\p{N}`) with a stable hash fallback for names with
  no letters/digits at all. → `src/pipeline/process.ts` (`slugify`).
- **`dist/changes.json` changelog feed.** Concerts new since the last run, so
  the consumer can show "N new concerts since your last visit" without
  diffing all of `concerts.json` itself. Identity reuses `processConcerts`'
  own dedupe key (artist+date+city) — not a second definition of "same
  concert". State (which concerts were already known) is deliberately *not*
  git-tracked — persisted via the same `actions/cache` mechanism
  `reports/scrape-cache.json` already uses, so it doesn't add another writer
  to `data/approved_artists.json`'s contention. Cold-start (first-ever run)
  reports zero changes rather than every concert at once. 30-day retention
  window. → `src/generator/changelog.ts`, wired into `src/run.ts`.
- **`priceRange`.** Best-effort ticket price (`{min, max, currency}`), from
  Ticketmaster's own structured `priceRanges` only — collapses multiple
  tiers (e.g. standard + VIP) to the overall min/max. Never guessed/parsed
  from scraped free text; venue scrapers just don't get one. →
  `src/schemas/concert.ts`, `src/engine/ticketmaster.ts`, `src/pipeline/process.ts`.
- **Sharded artist whitelist storage (`data/artists/shard-0.json`..`shard-7.json`,
  replacing the single 17MB `data/approved_artists.json`).** Root cause of a
  real, repeatedly-observed failure mode: every enrichment workflow (enrich-auto,
  enrich-database/wd-bulk, enrich-metadata, the daily scrape's own enrich step)
  reads and rewrites the WHOLE artist file, so two writers landing close together
  raced to push and one's work got dropped on an unresolvable rebase conflict —
  serialized via `concurrency: artist-db-write` already, but that only prevents
  parallel runs, not back-to-back runs close enough together to still collide on
  the same giant file. Sharding by the artist name's first character (mod 8)
  means two writers only actually conflict if they touched the *same* shard —
  most of the time they don't, so most conflicts are now structurally impossible
  rather than merely retried-and-hoped-to-resolve. New `src/pipeline/artistDb.ts`
  centralizes every load/save behind `loadApprovedArtists()`/`saveApprovedArtists()`
  (dual-mode: a `.json`-suffixed path is treated as the legacy single-file format
  the test suite's temp fixtures still use; any other path is treated as the
  sharded production directory), with a diff-before-write per shard so a save
  that only touched a few artists doesn't rewrite every other shard's file too.
  All 13 call sites that used to read/write `data/approved_artists.json` directly
  (`pipeline/process.ts`, `pipeline/enrich.ts`, `run.ts`, and 10 `scripts/*.ts`)
  now go through this module. → `src/pipeline/artistDb.ts`, `data/artists/`.
- **Eventbrite as a 4th concert source (artist-keyed).** Eventbrite shut off its
  public multi-organizer events-search API for third parties in Dec 2019 (the
  v3 API only covers events you already know the id/venue/organization for) —
  confirmed live, no newer public search product exists. The only remaining
  route is scraping the public `/d/<location>/<query>/` discovery pages, which
  embed a `window.__SERVER_DATA__` JSON blob with the same results the page
  renders. **This explicitly violates Eventbrite's Terms of Service** (section
  13.1 prohibits scraping) — a deliberate, accepted risk (same legal category
  as any venue-site scraper here, but against a platform with an explicit,
  prominent anti-scraping clause), kept low-volume/polite for that reason
  (2.5s spacing, 300 artists/run cap — smaller and gentler than Bandsintown's).
  Confirmed live that Eventbrite's `/d/` search is full-text over its ENTIRE
  catalog, not a real per-artist lookup like Bandsintown's endpoint — e.g. a
  "Dropkick Murphys" query surfaced hair-product workshops and golf outings
  that merely contain the word "Murphy", and every first-page result for
  "Metallica" was a tribute act. `mapEbResultToConcert` requires the queried
  artist name to LEAD the result's title as a relevance pre-filter (trades
  some recall for materially fewer false positives) before the shared
  cover/tribute-band filter (`process.ts`) even sees it. Scoped to the
  `united-states` location (Eventbrite's discovery UI has no "everywhere"
  search — a scope trim, not full coverage; overridable via
  `EVENTBRITE_LOCATION_SLUG`). Same batched/resumable/cache-fallback shape as
  the Bandsintown sweep, sharing the same `data/artist_scrape_targets.txt`
  target list. → `src/engine/eventbrite.ts`, `src/run-artists.ts`, `src/run.ts`,
  `.github/workflows/artist-scrape.yml`, `.github/workflows/daily-scrape.yml`.
- **"Similar artists" recommendations.** One Last.fm `artist.getsimilar` call per
  artist, cross-referenced against our own ~63k whitelist so every suggestion
  resolves to a real `artists/{slug}.json` -- a recommendation pointing outside
  this catalog would be a dead end for the consumer app, not a feature. Up to 8
  `{name, slug, match}` entries per artist, preserving Last.fm's match-descending
  order. Own pending-gate (`similarEnrichedAt`/`similarTriedAt`), independent of
  every other enrichment tier, same reasoning as the genres/popularity tier.
  Scheduled via `.github/workflows/enrich-similar.yml` (cron, checkpointed, same
  shape as `enrich-metadata.yml`), also runnable manually with
  `npm run enrich-similar [N]`. → `src/scripts/enrich_similar_artists.ts`,
  `src/generator/publish.ts` (`ArtistCatalogEntry.similarArtists`).

---

## 🚧 In progress

### Bandsintown coverage gap (client measured ~60% loss vs a live-only fetch)
Consumer app's own compare-script measured concerts present in this repo's
publish output but missing when it fetches Bandsintown live itself, ~60% for
spot-checked artists (AC/DC, A Day To Remember — both already in
`data/artist_scrape_targets.txt`). Root cause confirmed against this repo, not
the client: `artist-scrape.yml`'s Bandsintown sweep ran **weekly** at
800/2205 targets per run (~3-week full cycle) — an artist can sit stale for
weeks before its next fetch.

Plan (sequenced; don't touch the client/cut the server until the gate at the
end passes):
1. ✅ Cron `weekly -> daily` (`.github/workflows/artist-scrape.yml`).
   2205/800 ≈ 3-day initial backlog fill; steady-state throughput (~367/day
   for a 6-day freshness window, `DEFAULT_FRESHNESS_DAYS` in
   `src/engine/bandsintown.ts`) comfortably inside the 800/day cap — daily is
   sufficient, not overkill. Repo is public, so GH Actions minutes are free;
   no cost concern.
2. ✅ Dedupe case-variant duplicates in `data/artist_scrape_targets.txt`:
   2205 → 2126 (78 case-variant duplicates removed, e.g. "A Day to Remember"/
   "A Day To Remember"/"a day to remember" all counted as 3 separate
   Bandsintown fetch slots for one real artist, since
   `fetchBandsintownConcerts`'s own de-dupe is case-sensitive). →
   `src/scripts/clean_scrape_targets.ts`, run against the live target list.
3. ✅ Point official tour-page scrapers (`scrapers/artists/*.json` — more
   reliable than the public Bandsintown widget feed, no rate-limit/block
   risk) at our highest-value targets. Deliberately *not* sourced from the
   consumer app's own usage data (a user's saved-favorites list is a biased,
   manually-maintained proxy) — ranked instead by actual Last.fm popularity
   (`entry.popularity.listeners`, collected by `enrich_metadata.ts`, live
   Last.fm lookup as a fallback) among artists already on our own target
   list. `npm run rank-scraper-candidates [N]` / the manual-dispatch
   `rank-scraper-candidates.yml` workflow (needs `LASTFM_API_KEY`, already a
   repo secret) produces the ranked list; still needs a human to actually
   author each artist's selector config from it. →
   `src/scripts/rank_scraper_candidates.ts`.
4. ⬜ **Needs real elapsed time.** Let the new daily cron run 1-2 real cycles
   (at least one 6-day freshness window) before re-measuring.
5. ⬜ **Needs the client repo's tooling.** Re-run the consumer app's
   compare-script against fresh data.
6. ⬜ Decision gate: gap down to ~10-15% or less → cut the server, client
   moves to plain static fetch. Still high → the problem is coverage (missing
   scrapers/targets), not cron frequency — expand step 3, don't re-tune cron.

---

## 🔧 Tech debt / infrastructure

Distinct axis from the data-richness roadmap below: pipeline reliability,
safety, and dev tooling rather than product features. Last verified against
live repo/CI state 2026-07-08 (commit hashes / `gh run` ids given as evidence
below — re-check via `git log` / `gh run list` before assuming these are still
current if much time has passed).

### ✅ Done
- **Stranded-artist bug in the Gemini identity tier.** `apply()` used to stamp
  `enrichedAt` on every processed artist even when website/tourUrl/socials all
  came back empty — since `enrichedAt` is the cross-tier pending-filter
  marker, a genuine miss permanently hid that artist from every other
  enrichment tier. Added `sitesTriedAt` (tried) separate from `enrichedAt`
  (hit); migrated 168 pre-existing stranded records. →
  `src/scripts/enrich_sites.ts`.
- **SSRF-safe tourUrl discovery tier (new, 6th enrichment tier, zero LLM
  cost).** Probes common tour-page paths (`/tour`, `/shows`, ...) on the ~20k
  website-having/tourUrl-lacking artists, with soft-404 scoring to reject
  homepage-redirect false positives. `fetchHelper` originally only checked
  `isBlockedHost()` against the initial URL and followed redirects natively —
  a malicious/compromised site's `/tour` page could 302 to
  `169.254.169.254` (real cloud-metadata target on GH-hosted Azure runners)
  before any check ran. Fixed: `redirect:'manual'` + recursive per-hop
  `isBlockedHost()` validation. Validated on a real 60-artist batch (5 hits,
  manually curl-verified) and applied to production; **not** cron'd yet — see
  Open/medium below. → `src/scripts/discover_tour_urls.ts`,
  `tests/discover_tour_urls.test.ts`.
- **Gemini model/key cascade correctness.** Wrong model IDs
  (`gemini-3-flash`, `gemma-4-31b`, `gemma-4-26b`) 404'd forever without being
  marked exhausted; fixed to real IDs (`gemini-3-flash-preview`,
  `gemma-4-31b-it`, `gemma-4-26b-a4b-it`) and added 404 to the
  exhaustion-tracking logic alongside 401/403/429. `enrich-database.yml`'s
  `env:` block silently never wired the user's own
  `GEMINI_API_KEY_RESERV1/2` secrets into the job — fixed. →
  `src/scripts/enrich_via_gemini_search.ts`, `src/scripts/prune_non_artists.ts`,
  `.github/workflows/enrich-database.yml`.
- **`prune_non_artists.ts` hardening.** Added a Zod `classificationSchema`
  gate on Gemini's classification output; switched to `getGeminiKeys()`
  multi-key rotation; fixed a crash-on-single-batch-failure bug where an
  unconditional `throw` on any non-exhaustion error discarded every prior
  batch's already-classified results (the results file is written once, at
  the very end). → `src/scripts/prune_non_artists.ts`.
- **`backfill_mbid.ts` tried-marker.** Added `mbidBackfillTriedAt`, set on
  every processed entry (hit or miss), so a permanent miss doesn't get
  re-selected forever. → `src/scripts/backfill_mbid.ts`.
- **Custom scraper test coverage.** 23/23 `src/engine/custom/*.ts` scrapers
  now have fixture-driven tests (146 assertions) — previously untested;
  tests-only change, no scraper parsing logic touched. →
  `tests/custom-scrapers.test.ts`.
- **Geo-clustering for fragmented city names.** Same city split across
  ward/kanji/transliteration variants (e.g. Tokyo/所沢市) no longer produces
  separate `cities/{slug}.json` files — union-find + haversine clustering
  (35km radius) picks the most-represented raw string as canonical. Concerts
  without lat/lng fall back to their own unclustered city string. →
  `src/generator/publish.ts` (`buildCityCanonicalMap`), `tests/publish.test.ts`.
- **Workflow infra cleanup.** Fixed an infinite-loop-on-git-conflict bug (5
  workflows recomputed and dropped identical work forever after a rebase
  abort — missing `git fetch/reset --hard origin/main` before retry);
  retargeted `enrich-similar.yml` off the deleted
  `data/approved_artists.json` (was silently no-op'ing every run since the
  sharding migration); added `issues: write` + a deduped "Alert on failure"
  step to 6 workflows (daily-scrape, enrich-auto, enrich-metadata,
  enrich-similar, artist-scrape, discover-artists); fixed `daily-scrape.yml`'s
  "Upload fail log report" step missing `if: always()` (self-heal's artifact
  download was silently finding nothing on the exact runs where it mattered
  most); added `lint-workflows.yml` (actionlint, pinned `@v1.27.0`); fixed a
  shellcheck SC2086 (unquoted `$GITHUB_OUTPUT`) in `self-heal.yml`; added
  `permissions: contents: read` + `timeout-minutes: 30` to `pr-test.yml` and
  skip its `verify` job on `auto/self-heal-*` branches (was duplicating
  self-heal's own test gate on every auto-merge PR). →
  `.github/workflows/*.yml`, `.github/actions/alert-on-failure/action.yml`.
- **Docs/license cleanup.** `README.md`/`ENRICHMENT_RUNBOOK.md` no longer
  reference the deleted `data/approved_artists.json` path; added a Consumer
  Quickstart section to the README; added a root `LICENSE` (ISC).

### ⬜ Open — critical
- **`daily-scrape.yml` has not deployed since the geo-clustering fix landed.**
  Fix commit `9215c33` (2026-07-08 17:00 UTC); no `daily-scrape.yml` run with
  `conclusion=success` exists after that timestamp as of last check — one
  dispatch attempt (`28963191211`, 17:39 UTC) got cancelled in the
  `artist-db-write` concurrency queue before it ran a single step. Production
  API is still serving pre-fix data (fragmented Japan city files, etc). Needs
  a re-trigger once the concurrency group frees up.
- **`artist-db-write` concurrency group silently cancels queued runs.**
  Observed repeatedly (7 cancellations in the last 30 runs across
  daily-scrape/enrich-auto/enrich-database) — GitHub hard-cancels an older
  *pending* run when a newer one queues behind it in the same group,
  regardless of `cancel-in-progress: false`. No metric distinguishes this
  from a normal git-conflict drop (`record-conflict-drop` only fires from
  inside a job that reached the rebase-conflict step, not a queue-cancel).
  *A worktree `.claude/worktrees/fix-daily-scrape-concurrency` already
  exists — check it's not already mid-fix in a parallel session before
  starting here.*
- **No shared `ArtistEntrySchema`.** 9 distinct `interface ArtistEntry { ... }`
  declarations across `src/`, none importing a common definition. Explicitly
  deferred — too risky to parallelize with other file-touching work; needs
  its own dedicated pass.

### ⬜ Open — high
- **No ESLint/type-lint gate for `src/` TypeScript.** Only YAML/bash linting
  exists (`lint-workflows.yml` → actionlint); no `eslint` devDependency, no
  config file.
- **`enrich-database.yml` has no cron**, `workflow_dispatch` only — the
  Gemini identity/socials tier still needs manual triggering.
- **No test coverage tool** (c8/nyc) — `npm test` has no `--coverage` path.

### ⬜ Open — medium
- **Data-hygiene scripts not scheduled.** `prune_non_artists.ts`,
  `clean_denylist.ts`, `audit_artist_gaps.ts` all exist but aren't referenced
  by any workflow — manual-only.
- **`freshness-watchdog.yml` only checks CI run conclusion**, not the actual
  deployed JSON artifact — would not have caught the stale-deploy situation
  above.
- **`discover_tour_urls.ts` at 60/20,187 eligible artists.** Validated batch
  only; intentionally not cron'd yet per its own task spec until proven at
  scale. Next step: run larger batches, spot-check hits, then decide on
  wiring a workflow.
- **2 entries in `data/artist-review-needed.json`** ("Airport", "Empire")
  awaiting manual disambiguation (place name vs. real artist).

### ⬜ Open — low / roadmap
- No OpenAPI/JSON-Schema contract describing the published JSON shape.
- `concerts.json` and per-artist/city files are unpaginated full dumps.
- No JSON 404 for an unknown artist/city slug (falls through to GitHub
  Pages' generic HTML 404).
- No documented secrets-rotation runbook (only the multi-key *failover*
  mechanism is documented, not a rotation/revocation procedure).
- No Dependabot/Renovate; GitHub Actions pinned to floating version tags
  (`@v4` etc), not commit SHAs (except `reviewdog/action-actionlint@v1.27.0`).
- Minor duplicated helpers: `function sleep()` reimplemented independently
  in 7 files; `.env`-fallback key-loading regex duplicated verbatim in
  `enrich_via_gemini_search.ts` and `prune_non_artists.ts` instead of one
  shared helper; `list_models.ts` skips `getGeminiKeys()` entirely.

---

## ⬜ Planned — data richness roadmap

Ordered by leverage on the north-star flow. **Constraint: free sources only —
no Spotify API (paid tier unavailable).** Sourcing noted per item.

### Tier 0 — cleanup (quick)
- ✅ **Denylist intake guard.** `data/artist_denylist.json` already covers real
  genre/language noise (`Alternative rock`, `Afrikaans`, etc.) and none of it is
  currently present in `data/approved_artists.json` (verified live). The 4 names
  originally flagged here (`Amsterdam`, `Anonymous`, `Area`, plus `Berlin`/
  `Chicago`/`Live` seen in the same audit) turned out on inspection to be real
  touring acts with confirmed MusicBrainz/Wikidata/Spotify presence — denylisting
  them would have deleted real coverage, so they're deliberately excluded (see
  the `_comment` in `data/artist_denylist.json`). What *was* missing was a guard
  on the intake side: `pipeline/enrich.ts`'s "add unrecognized artist from a
  Gemini response" fallback could have silently re-added a denylisted term right
  after `clean_denylist.ts` removed it. Fixed via a shared
  `src/pipeline/denylist.ts` guard, applied at that intake point and reused by
  `clean_denylist.ts`. → `src/pipeline/denylist.ts`, `src/pipeline/enrich.ts`,
  `src/scripts/clean_denylist.ts`.

### Tier 1 — make matching work (identity)
_(done — see ✅ Done above)_

### Tier 2 — ranking & recommendations
_(done — see ✅ Done above)_

### Tier 3 — richer events
- ✅ Event time, festival awareness, venue kind, price range — see ✅ Done above.

### Tier 4 — dropped
- ❌ Nearest airport (IATA) — not needed.
- ❌ Full venue address — not needed (replaced by "venue kind" above).

---

## 💡 Ideas / parking lot

- ❌ Merge cross-source duplicates' ticket links into one canonical concert
  (e.g. an array of purchase options across venue/Ticketmaster/Bandsintown).
  Declined: exact-duplicate concerts (same artist+date+city) already merge
  into one record today; this idea was specifically about *also* keeping
  every source's ticket link instead of just one. Not wanted — surfacing
  multiple ticket platforms isn't a goal here.
- 💡 Currency-normalized price + affiliate ticket links.

---

## Conventions

- One line per item, prefixed with a status emoji. Move items between sections as
  they progress; don't delete — a done item is the record that it shipped.
- When an item ships, note the touch-point file(s) so the history stays traceable.
