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
- **Bandsintown spam-venue filter.** Live investigation confirmed fabricated RU
  tour dates for real artists (e.g. "Сплин в Ижевске") — Bandsintown's public
  widget feed lets third parties attach events to any artist page with no
  verification. `isTemplatedArtistCityVenueName()` rejects any event whose venue
  name matches the `"<artist> in/в <city>"` spam pattern. →
  `src/engine/bandsintown.ts`.
- **`ticketUrl` now prefers the artist's own site over a raw ticket-vendor
  link.** Product decision: a ticket-purchase link is often confusing out of
  context (unclear what the page even is); the artist's own known website is a
  safer default landing page. Falls back to the raw source ticket link only
  when no artist website is known. → `src/pipeline/process.ts`.
- **Auto-prune permanently-dead scraper configs.** `heal.ts` deliberately skips
  `fetch_error`/`csr_detected`/`circuit_open` failures (a broken CSS selector
  can't be repaired on a page that never loaded) — these configs accumulated
  forever with zero automated cleanup. `prune_dead_scrapers.ts` tracks
  consecutive-failure streaks per scraper (`data/scraper-health.json`), and once
  a config hits 5 straight prunable failures, deletes the dead scraper config +
  resets that artist's `tourUrl`/`tourScraperTriedAt`/`tourScraperCreatedAt`/
  `tourUrlProbeTriedAt` markers so it's eligible for re-discovery, logging every
  prune to `data/pruned-scrapers.json` for audit. Skips the artist-field reset
  (but still prunes the dead scraper) when 2+ DB entries share a
  case-insensitive name, rather than guessing which one to touch. Runs after
  every daily scrape via `workflow_run`, joins the `artist-db-write` concurrency
  group. → `src/scripts/prune_dead_scrapers.ts`,
  `.github/workflows/prune-dead-scrapers.yml`.
- **LLM-extraction fallback for zero-result scraper runs.** Closes the gap
  between a CSS selector breaking and `heal.ts` repairing it: when both the
  static selector and the existing free JSON-LD fallback return zero events on
  a page that fetched fine and isn't CSR, ask Gemini to extract concerts
  directly from the same already-fetched HTML. Per-run budget (30 calls,
  race-safe synchronous check-then-decrement), `ticketUrl` output goes through
  `safeAbsoluteUrl()` like every other source, hallucination risk bounded by
  the existing artist-whitelist match + date validation downstream. Wired into
  `runner.ts`'s `static_selectors`/`playwright_render` branches only;
  `daily-scrape.yml` and `artist-scrape.yml` both got the full Gemini
  key-rotation secret set (previously missing/partial, which would have made
  this silently no-op or quota-starved). →
  `src/engine/llm_extraction_fallback.ts`, `src/engine/runner.ts`.

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
live repo/CI state 2026-07-21 (commit hashes / `gh run` ids given as evidence
below — re-check via `git log` / `gh run list` before assuming these are
still current if much time has passed).

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
- **Graceful self-imposed soft-deadline in the 4 checkpointed enrich
  workflows.** Each previously ran until GitHub Actions force-killed it at
  its own `timeout-minutes`, reporting the whole run as failed and tripping
  the "Alert on failure" issue — even on a completely normal, large-backlog
  day. Each loop now tracks true job-elapsed time (captured in a "Record job
  start time" step before any other work) and self-stops 15 minutes before
  its own timeout, exiting success at a clean checkpoint boundary instead of
  being force-killed mid-sub-chunk. →
  `.github/workflows/{enrich-auto,enrich-metadata,enrich-database,enrich-similar}.yml`.
- **Shared `ArtistEntrySchema`.** Unioned all 9 previously-diverging
  `interface ArtistEntry` declarations into one canonical Zod schema (every
  field optional except `name`), all 10 call sites now import it. Adversarial
  review found zero dropped fields / no incorrectly-tightened requiredness;
  `tsc`+`npm test` clean. → `src/schemas/artist.ts`.
- **`enrich-database.yml` cron** (`0 5 * * *`, confirmed clear of every other
  workflow's cron slot). **Test coverage tooling** (`c8`, `npm run
  test:coverage`, `.c8rc.json`). **Dependabot** (npm + github-actions, weekly
  — already opened its first PRs, see the new open item below re: the zod
  major-version one). **Secrets rotation runbook** section in
  `ENRICHMENT_RUNBOOK.md` (distinct from the existing multi-key
  quota-*failover* docs).
- **`freshness-watchdog.yml` now verifies the live deployed artifact**, not
  just the CI run's own conclusion — fetches the real
  `https://cartograf666.github.io/concert-for-travelers-api/index.json` and
  checks HTTP 200 + valid JSON + `stats.totalConcerts > 0`, in addition to
  the pre-existing run-recency check. → `.github/workflows/freshness-watchdog.yml`.
- **Data-hygiene scripts wired into a workflow** (`prune_non_artists.ts`,
  `clean_denylist.ts`, `audit_artist_gaps.ts`) — new
  `.github/workflows/data-hygiene.yml`, deliberately `workflow_dispatch`-only
  (no cron — both prune/clean write `data/artists/` via Gemini classification
  with real false-positive risk, matches the existing human-review pattern).
  Adversarially reviewed clean: correct concurrency group, correct
  conflict-drop ordering, verified against a real git-conflict test harness.
- **OpenAPI 3.0 contract** for the published static JSON shape (`concerts.json`,
  `artists.json`, `artists/{slug}.json`, `cities/{slug}.json`, `index.json`,
  `changes.json`, `status.json`). → `docs/openapi.yaml`.
- **De-duplicated `sleep()`** (was reimplemented independently in 7 files,
  now one `src/engine/sleep.ts`) **and `.env`-fallback Gemini-key loading**
  (extracted to `loadDotEnvFallback()` in `src/engine/gemini_keys.ts`,
  reused by `enrich_via_gemini_search.ts` and `list_models.ts`).
- **`daily-scrape.yml` deployed the geo-clustering fix.** Third dispatch
  (`28973869993`, 20:35 UTC) got through — live `index.json` now shows
  `schemaVersion:1`, `artists.json`/`changes.json` return 200,
  `uniqueCities` dropped 1964→971 (real evidence the Tokyo/所沢市-style
  ward/kanji merges are live in production, not just tested).
- **ESLint / type-lint gate for `src/`.** Narrow ruleset
  (`no-floating-promises` type-aware, `no-unused-vars`,
  `consistent-type-imports` — deliberately NOT a broad recommended/strict
  preset, to avoid flooding a 60+-file codebase with pre-existing `any`
  noise). Non-blocking in CI for now (`continue-on-error: true` in
  `pr-test.yml`) until the existing-warning backlog is at zero. Fixed the 6
  real floating-promise sites it found (`heal.ts`, `run.ts`, `run-artists.ts`,
  `clean_artists.ts`, `download_artists.ts`, `geocode_venues.ts`) — double
  adversarially reviewed, confirmed behavior-neutral (matches a pattern
  already used in ~20 other entrypoints) and does **not** touch
  `clean_artists.ts`'s dedupe/merge logic (the file with the earlier
  data-loss bug this session). → `eslint.config.js`.
- **GitHub Actions SHA-pinned.** Every `uses:` across all 12 workflow files +
  the composite action now pins an immutable commit SHA (with the human
  version kept in a trailing comment), replacing floating `@v4`-style tags.
  *Caught and fixed during review*: the first pass pinned 4 actions
  (`setup-node`, `upload-artifact`, `deploy-pages`,
  `peter-evans/create-pull-request`) to their pre-Dependabot versions because
  the branch hadn't yet incorporated that day's Dependabot merges — re-pinned
  to the correct current versions during rebase. *Known maintenance cost*:
  SHA-pinning and Dependabot are in mild tension — every Dependabot version
  bump now needs a matching SHA re-pin, not just a tag edit; expect an
  ongoing trickle of Dependabot PRs for this repo's actions (6 more opened
  since, see Open/medium below) that each need this treatment.
- **Auto-retry once when `daily-scrape.yml` is cancelled by concurrency
  preemption.** New `.github/workflows/daily-scrape-retry.yml`, triggered on
  `workflow_run` completion, re-dispatches exactly once when the triggering
  run was `cancelled` AND was a manual `workflow_dispatch` (never retries a
  cancelled `schedule`/cron trigger, to avoid compounding queue pressure).
  *Caught and fixed during review*: the first version tried to detect
  "already a retry" by reading `.inputs.is_retry` off the GitHub REST "get a
  workflow run" API — that field doesn't exist on that endpoint (confirmed
  live), so the guard always silently resolved to `false` and could never
  stop a retry-of-a-retry, i.e. an unbounded auto-retry loop feeding the
  exact concurrency contention this workflow exists to relieve. Fixed by
  surfacing the flag into `run-name:` (the one thing that does survive into
  `workflow_run`'s `display_title`) and gating on that instead. This
  *mitigates* the daily-scrape-specific symptom of the concurrency-starvation
  item below; the underlying starvation mechanism itself is still open.
- **Doc-comment restoration, `list_models.ts` multi-key debug, static-404
  docs.** Restored the two module-level doc comments lost as scope creep
  during the `ArtistEntrySchema` consolidation
  (`enrich_metadata.ts`/`enrich_similar_artists.ts`); `list_models.ts` now
  iterates and labels every key `getGeminiKeys()` returns instead of only the
  first; documented GitHub Pages' static-404 limitation in
  `docs/openapi.yaml`/`README.md`. *Caught and fixed during review*: that
  404-limitation note first said to check a requested slug directly against
  `index.json`'s `artists`/`cities` arrays — those hold raw display names,
  not slugs, so a direct comparison would almost never match; corrected to
  tell consumers to `slugify()` each name first.
- **Additive pagination for `concerts.json`.** `dist/concerts/page-N.json`
  (500/page) alongside the existing, untouched full `concerts.json` dump;
  `pageCount`/`pageSize` added to `index.json`. *Caught and fixed during
  review*: orphan-page pruning matched any `*.json` in `dist/concerts/`
  rather than the specific `page-N.json` pattern — harmless today since
  nothing else writes there, but tightened to an exact regex so it can't
  reach further than intended if that ever changes. →
  `src/generator/publish.ts`.

- **`artist-db-write` concurrency-starvation watchdog.** New
  `.github/workflows/concurrency-watchdog.yml` (every 6h) +
  `src/scripts/check_concurrency_drops.ts`: scans recent runs of all 6
  `artist-db-write`-group workflows for the exact
  `Canceling since a higher priority waiting request` annotation, records
  each to `data/concurrency-drops.json`, opens/updates a dedup'd issue past
  a threshold. *Caught and fixed during review*: its push-retry loop did
  `git reset --hard origin/main` + `continue` on a rebase conflict instead
  of `break` + warn like every other writer in this repo — silently
  discarded its own just-recorded drop and reported false success on the
  next (no-op) push. Fixed to match convention; also added the
  previously-missing `data-hygiene.yml` to its watch list.
- **zod v3→v4** (4.4.3). Adversarially verified via a shadow v3 install and
  side-by-side `.safeParse()` probing across every real schema in this repo
  (Concert/Artist/Config/RepairedSelectors) — no behavioral change, only
  cosmetic error-message wording. Safe.
- **6 Dependabot PRs merged** (`actions/checkout`→v7, `actions/configure-pages`→v6,
  `actions/github-script`→v9, `reviewdog/action-actionlint`→v1.72.0, `c8`→11.0.0,
  `@ai-sdk/google`→4.0.10, plus zod above). `typescript`→7.0.2 (PR #21) left
  open on purpose — see TS7 item below, don't merge it.
- **Artist whitelist trimmed to a "professional" tier + composite popularity
  score.** See the score/tier item further up — same work, cross-referenced
  here since it's also what made the rest of this list possible: 20,528
  professional / 42,649 longtail (of 63,177 pre-existing + 47 new artists
  discovered mid-session). `discover_tour_urls.ts` and the Bandsintown/
  Eventbrite sweep (`run-artists.ts`) now scope to this tier (+ untiered,
  fail-open for not-yet-scored artists) instead of the full whitelist —
  this is the actual fix for "pipeline is too slow," not just a data-quality
  change.
- **`reapply_artist_db_delta.ts`: replaces whole-sub-chunk conflict-drop with
  per-artist delta replay** across all 6 `data/artists/`-writing workflows.
  *Caught and fixed during review*: the first version blindly overwrote a
  row keyed only by artist name with no check that the freshly-reset origin
  state hadn't ALSO diverged from this sub-chunk's own snapshot for that
  same row — reproduced concretely: a concurrent writer's already-merged
  change to a shared artist record could be silently clobbered, and not just
  dropped but actively regressed to a stale value. Fixed to skip (not
  overwrite) a row that diverges from both snapshots
  (`skippedConflicts`), conservative by design — same "drop rather than
  corrupt" philosophy as before, just scoped to the single conflicting row
  instead of the whole sub-chunk.
- **New tourUrl→LLM scraper-config extraction tier** (`extract_tour_scrapers.ts`,
  script + tests only, deliberately **not** wired into a workflow yet — needs
  the same real-batch human-validation pass `discover_tour_urls.ts` went
  through first). *Caught and fixed during review*: an SSRF-via-redirect gap
  (same class already fixed once this session in `discover_tour_urls.ts` —
  fetch followed redirects natively, checking the blocked-host list only
  against the initial URL) and a config-hijack bug (the LLM-returned object
  was spread AFTER the code-controlled `id`/`domain`/`url` fields, so a
  prompt-injected field in Gemini's response could silently override the
  real artist's tourUrl/domain) — both fixed before this landed.
- **Artist-review-needed backlog resolved** (see Done note above under
  zod/Dependabot — cross-referenced here): "Airport" kept (real, corroborated
  touring act), "Empire" removed to `data/removed-non-artists.json` (weakest
  signal of the two, risk accepted knowingly). `data/artist-review-needed.json`
  is now empty. *Note: an earlier automated pass had resolved this identically
  but bypassed the human-review gate entirely with zero reasoning trail —
  redone properly as an explicit, logged human decision.*
- **Self-heal's auto-merge silently broken for ~2 weeks — repo setting, not
  code.** Root cause of a visible "big scraper degradation": 65 scrapers
  failing, and `heal.ts`'s repair PRs weren't auto-merging because "Allow
  GitHub Actions to create and approve pull requests" was off at the repo
  level — outside what this session could flip via the API (Claude Code's own
  auto-mode classifier blocked the `gh api ... actions/permissions/workflow`
  call as a permissions change). Fixed by the user via the GitHub UI;
  re-ran the previously-failing self-heal workflow afterward and confirmed it
  completes green end-to-end. Of the 65 failures, 45 were
  `fetch_error`/`csr_detected`/`circuit_open` — permanently unfixable by
  selector-repair by design, which is what motivated the two items directly
  above (auto-prune + LLM-extraction fallback).
- **7 more Dependabot PRs merged**: `actions/checkout`→v7.0.0,
  `actions/setup-node`→v7.0.0, `actions/cache/restore`+`/save`→v6.1.0,
  `actions/upload-pages-artifact`→v5.0.0, `ai`→7.0.28, `chrono-node`→2.10.0,
  `tsx`→4.23.1. `typescript-eslint`→8.64.0 merged; `typescript`→v7 (PR #21)
  still deliberately left open, see TS7 item below.

### ⬜ Open — critical
- **`artist-db-write` concurrency group's actual queue-preemption is still
  unfixed, only observed/mitigated.** The watchdog gives visibility; the
  auto-retry workflow recovers `daily-scrape.yml`'s manual dispatches;
  `reapply_artist_db_delta.ts` means a real conflict now costs at most one
  skipped artist-row instead of a whole sub-chunk. But the 5 scheduled
  enrich-* workflows can still lose their queued *slot* (never even start)
  to each other with no automatic recovery — that's a different failure
  mode than a mid-run conflict, still open. *A worktree
  `.claude/worktrees/fix-daily-scrape-concurrency` existed earlier this
  session (deleted — confirmed fully merged) — if a new one appears, check
  it's not already mid-fix in a parallel session first.*

### ⬜ Open — high
- **TypeScript v7 migration attempted and reverted.** `typescript-eslint@8.63.0`
  declares a peer dep of `typescript >=4.8.4 <6.1.0` — 7.0.2 is out of range
  (`npm ls` reports it invalid). The attempted fix was an `eslint-patch.js`
  monkeypatching `Module._resolveFilename` to silently redirect ESLint's
  internal `require('typescript')` to a separately-installed `typescript-v5`
  alias — meaning the type-aware `no-floating-promises` rule would've been
  checked against TS5's type checker while the project actually builds on
  TS7, a real (if narrow) silent-wrong-lint-results risk for no real
  benefit. Reverted; back on `typescript@5.9.3`. Dependabot PR #21 left open
  and intentionally unmerged. Revisit once `typescript-eslint` has real TS7
  support — don't repeat the monkeypatch approach.

### ⬜ Open — medium
- **`discover_tour_urls.ts` at 60/9,228 eligible artists** (eligible count
  dropped from 20,187 now that candidate selection is scoped to the
  professional tier). Validated batch only; intentionally not cron'd yet.
  Default batch size stays 60 — no per-slice checkpointing exists yet (one
  save at the very end), so don't raise the default until that's added.
- **`extract_tour_scrapers.ts` has no workflow yet** — needs the same
  real-batch validation pass before it earns one. When it does, keep it
  `workflow_dispatch`-only at first, same as `discover_tour_urls.ts` was.
- **No scheduled re-scoring for the popularity tier.** `score_artist_popularity.ts
  apply` is a fully manual, human-run script with a hand-picked threshold —
  nothing re-runs it on a cadence. Currently masked because new artists from
  `discover-artists.yml` flow through `data/artist_scrape_targets.txt` (which
  bypasses the tier check entirely in both `discover_tour_urls.ts` and
  `run-artists.ts`'s fail-open-for-untiered logic) — but any future intake
  path that adds straight to the whitelist DB without also being a target-
  list line would sit un-scored (and un-swept) indefinitely.
- **`score_artist_popularity.ts`'s 100k professional-tier cap only applies
  within the score-ranked selection loop** — protected/explicit targets are
  unioned in afterward with no subsequent cap re-check, so the true final
  size can exceed 100k once the whitelist grows large enough that protected
  targets + capped-scored-set > 100k. Doesn't bind today (~63k total
  artists). No test file exists for this script yet.
- **`wikidataSitelinks` is 0 for every artist** in the current data — the
  SPARQL query was extended to pull it, but `enrich-wd-bulk` hasn't re-run
  against the network since. The popularity score's sitelinks component
  (25% weight) is a no-op until that next runs; re-run `npm run enrich-wd-bulk`
  and re-score once it has.

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
- **This file is the single source of truth for current status.** `README.md`/
  `ENRICHMENT_RUNBOOK.md` are user-facing docs, kept current but not a status
  log. `docs/*.md` are living process/convention notes (how to add a venue
  scraper, concurrent-session courtesy protocol). `docs/archive/` holds
  point-in-time task briefs whose content has fully shipped or been
  superseded — historical reference only, not maintained, may reference
  deleted paths. `.ai/architecture.yaml` is the architecture manifest
  (layer boundaries/dependency rules) — separate axis from this file, only
  edited for an intentional architecture decision.
