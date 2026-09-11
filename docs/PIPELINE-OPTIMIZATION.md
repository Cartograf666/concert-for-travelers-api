# Publication and background enrichment

Daily publication follows completion of `Artist Tour-Page Scrape` on the default
branch, including failed/cancelled producer runs. Manual daily dispatch remains
available. There is no second independent daily scrape schedule. If the producer
workflow is disabled or never starts, publication must be dispatched manually.
The shared `artist-db-write` lock remains necessary for target sync and activity
stamps; long enrichment jobs can still delay publication in the queue.

Publication always normalizes current inputs once: unchanged venue responses do
not imply unchanged artist caches, metadata, or date-filtered output. Active-artist
metadata enrichment now runs in `Enrich Artist Database`, using the previous
published concert list and the existing conflict-safe database delta commit.
New metadata is visible on a subsequent publication, not in the same scrape.

## Geocoding

Publication performs cache-only geocoding. `Geocode Backfill` runs every six hours,
with up to 100 sequential attempts per run and 15.1 seconds between requests. The
existing Axios transport uses HTTPS, an identifying project User-Agent, optional
`NOMINATIM_EMAIL`, and a 20-second timeout. This follows the regular-script limit
of four requests/minute in the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
Do not run another bulk geocoder concurrently with this workflow.

Backfill checkpoints locally after each attempt and saves the primary
`geocode-v1-*` Actions cache even after a failed step. Its step timeout is 45
minutes inside a 55-minute job, leaving time to save partial progress. The 400/day
nominal ceiling is not a promise under provider errors, timeouts or missed runs.
New venues may remain without coordinates until backfill and the next publication.

The `publish-site-v2-*` cache bundles the last-good site and a separate
`reports/geocode-cache-backup.json`. This sidecar keeps original place keys,
including untranslated city names, and is never copied to Pages. Daily and
backfill merge the primary and backup caches. Legacy site-cache restoration is
kept for migration. Before the first v2 backup, or if both caches are evicted,
this is not durable archival storage: missing geocoding must be rebuilt.

## Bandsintown

Keep the 800-attempt ceiling and existing request spacing. Twenty percent of
slots prioritize stale active-tour artists; remaining slots use global
oldest-attempt order, with unused capacity shared. The lanes are interleaved so
an active-error cluster cannot block all discovery work. Attempt time does not
masquerade as successful-fetch freshness, and errors retain last-good events.

Six days is a minimum refresh interval, not an all-artist SLA. At 20,711 targets,
800/day cannot cover the roster in fewer than 26 runs. The all-empty and all-active
successful simulations cover that capacity case; mixed failures/priority and
missed runs can take longer. Logs report cohort attempts/yield, never-fetched
backlog and successful-cache age quantiles.

## Rollout verification

These changes are local until committed and deployed. Compare at least two full
production cycles after rollout, including queue delay, rather than extrapolating
a speedup from unit tests. Record:

- venue/artist acquisition, normalization and publication durations;
- zero live Nominatim requests and no Gemini metadata pass inside publication;
- cross-run geocode cache hits, unresolved unique places and retry progression;
- Bandsintown cohort yield, backlog, p95/max successful-cache age;
- publication after artist completion and last-good fallback after failures.

Eventbrite's observed 405 responses remain a source-quality issue, not a major
runtime saving. Its last-good cache is retained. Scraper cancellation and dashboard
micro-optimizations were not changed in this optimization pass; they need separate
evidence before adding complexity.
