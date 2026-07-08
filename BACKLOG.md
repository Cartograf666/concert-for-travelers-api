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
  Bandsintown (artist-keyed, worldwide — covers Asia/Japan and RU artists).
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
  run would add real coupling for little marginal coverage. Not yet wired into a
  scheduled GitHub Action (unlike `enrich-auto`/`enrich-wd-bulk`) — run manually
  via `npm run enrich-metadata [N]` until someone adds a workflow for it. →
  `src/scripts/enrich_metadata.ts`.
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

---

## 🚧 In progress

_(nothing active)_

---

## 🐛 Known issues (found during Tier 1–3 implementation, not on the roadmap above)

- **`slugify()` drops non-Latin-only artist names to an empty string.** Affects
  91/63,490 whitelisted artists today (all Cyrillic, e.g. "Алла Пугачёва") —
  they'd collide into the same `dist/artists/{slug}.json` file / `dist/artists.json`
  catalog entry if any two of them ever have a concert in the same run, silently
  merging unrelated artists. Pre-existing bug, surfaced by testing the new
  `dist/artists.json` catalog against the real whitelist at full scale — not
  something this pass fixes (needs its own careful Unicode-aware slug fix +
  regression coverage). Spawned as a separate follow-up task.

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
- ✅ Event time, festival awareness, venue kind — see ✅ Done above.
- 💡 **Price** — best-effort only. Add if a source exposes it cleanly
  (Ticketmaster priceRanges); skip otherwise. Not a priority.

### Tier 4 — dropped
- ❌ Nearest airport (IATA) — not needed.
- ❌ Full venue address — not needed (replaced by "venue kind" above).

---

## 💡 Ideas / parking lot

- 💡 Publish a lightweight changelog feed (`dist/changes.json`) so the consumer
  can show "newly announced since your last visit".
- 💡 Deduplicate the same show scraped from multiple sources (venue + Ticketmaster
  + Bandsintown) into one canonical concert with merged ticket links.
- 💡 Currency-normalized price + affiliate ticket links.

---

## Conventions

- One line per item, prefixed with a status emoji. Move items between sections as
  they progress; don't delete — a done item is the record that it shipped.
- When an item ships, note the touch-point file(s) so the history stays traceable.
