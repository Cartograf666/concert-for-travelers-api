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
