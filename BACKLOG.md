# Backlog

Living backlog for the concert-data API. Backend/data-only repo — a separate
app (`concerts-for-travelers`) consumes the published JSON.

**North-star user flow (consumer app):**
User adds the artists they love → enters vacation date windows → app returns
which concerts they can attend, and where. This repo's job is to feed that flow
with data rich enough to (1) **match** the user's artists reliably, (2) **place**
each concert in space and time, and (3) **rank** the options.

Legend: ✅ done · 🚧 in progress · ⬜ planned · 💡 idea

## Calendar and cancellation continuation — 2026-10-07 (implemented; hosted verification pending)

- Four source repairs: Alabama Symphony's native adult calendar and verified venue
  cities; Mellencamp's strictly verified native empty calendar; Paralamas native
  pagination, including the missing 2027-03-06 Montes Claros event; Ray Scott's
  rendered first-party widget with seven observed concerts and verified Pensacola
  Beach geography. Ray's profile-count mismatch (eight versus seven actual widget
  events) remains explicit. Local success is not a hosted/publication claim.
- Six Twin Atlantic October shows are explicitly cancelled by the promoter.
  Exact artist/date/place guards remove restored stale rows and preserve Leeds
  October 16. Ticketmaster native cancelled/postponed statuses are now excluded;
  offsale and rescheduled events retain their existing behavior.
- AngelHeart candidate withdrawn: current catalog website/calendar and music
  metadata belong to different same-name entities. Canonical target is unresolved;
  no unrelated empty calendar or catalog edit improves the health counter.
- Dependency PRs #209/#210/#211 are merged. Combined local checks after fresh
  install: **766 pass / 1 skip / 0 failures**, build and lint pass (103 existing
  warnings); selector ratchet 126 <= 131; npm audit reports zero vulnerabilities.
  Independent gpt-6-sol review covered parsing, cancellation scope and pagination.
- The original 415 artist and 152 venue IDs remain. Full hosted collection,
  completed Pages deployment and producer/public artifact comparison are next;
  the preceding published counts below are historical, not a new projection.
  Current evidence and rejected candidate are in `docs/source-recovery-20261006.json`
  under `continuation20261007`.

## Remaining-source repair continuation — 2026-10-06 (published; explicit source gaps remain)

- All 52 preceding failures were inspected. Seventeen source extractors were adjusted
  in PRs #190, #192, #193 and #195 plus Wix, Jorge and All That Remains follow-ups; Alabama 3, Scotty McCreery and Ellen ten Damme were
  newly regressed sources discovered by the first hosted follow-up. Current
  source, identity and date evidence is preserved per source in
  `docs/source-recovery-20261006.json`.
- Final hosted artist run [37536188687](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/37536188687)
  on `465b936` verifies **395/415** (preceding public slice 394/415).
  Final daily [37538576063](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/37538576063)
  on `465b936` verifies **128/152** (preceding slice 121/152)
  and completes Pages deployment. Both manifests enumerate every original ID;
  no config is removed to shrink a denominator. 44 current failures remain;
  latest outcomes replace local success projections and the intermediate 392/415.
- Public status generated `2026-10-06T22:24:12.717Z` is byte-identical to
  this daily's publication artifact (SHA-256 `6d3ed6de716d50524f7d21514836dcb330e7a351ea014769847abdeceaf13eb9`). The API contains
  **51,799 published concerts**, +727 against 51,072 before this continuation.
  Publication gate and rejection/duplicate diagnostics are preserved in the report.
- Current-date fixes cover RUST, Majestic, Antone's, Marmalade, O.A.R., Kingfisher
  Sky, Peter Smith, Stephanie Rainey, Paul Halley and the three new regressions.
  Ellen preserves all 62 printed Dutch dates instead of 32. Train now accepts
  verified US states rather than only Florida; its live three-show feed and latest
  hosted outcome are recorded in the report. Unknown geography
  or invalid dates fail explicitly; group performances keep their group names.
  Stephanie Rainey has a separate canonical identity; Peter Smith's Spotify
  link is corrected without replacing unrelated metadata.
- The exact wrong Bandsintown event 1038425781 is excluded for the Canadian
  Pain For Pleasure MBID. Organizer evidence identifies a distinct French
  tribute band. Raw cache retains provider identity independently of purchase
  links; internal metadata is absent from public output. Final public verification
  confirms the wrong attribution is absent. Other same-name identities/events
  remain allowed. Cancelled intermediate daily 37498109196 started collection
  but never deployed; its partial output is historical, not a final result.
- Four exact Bandsintown events belonging to the Aarhus TRAIN venue/promoter
  are excluded from the American Train identity using its canonical Spotify ID.
  Primary venue/promoter and ticketing pages identify other performers. Final
  public checks confirm those four rows are absent while all three official
  US feed shows remain. The rule does not exclude countries or artist names.
- CI on the latest Wix head: **737 pass / 1 skip / 0 failures**, build, lint,
  selector and artist-data integrity gates pass. Integrity retains the unchanged
  144-error baseline; lint retains 103 existing warnings.
- CI on the preceding provider-identity head: **727 pass / one skip / zero failures**, build,
  lint and selector ratchet pass; lint retains 103 existing warnings. Code review:
  harness-native fallback. Independent gpt-6-sol review found/rechecked the
  external purchase-link identity loss and empty-city bug and passed Ellen's
  explicit-date parser; root checked the Train state/date change against the
  captured and live three-event feed and independently verified the four exact
  provider collisions against six unchanged real-cache fixtures. Full CE nested
  dispatch was prohibited by reviewer role in the earlier review attempt;
  no full CE receipt is claimed.
- The latest Wix follow-up repairs The Fizz and Allan Stewart with current
  first-party calendar evidence. The Fizz yields 15 printed events, 14 future;
  its exact catalog identity and official Spotify are corrected. Final public
  checks preserve all 14 dates under The Fizz and remove their attribution to
  The Firm. Legacy Bucks Fizz and genuine The Firm identity matches remain intact.
  Allan reads seven explicitly timed music/comedy performances from the linked
  venue calendar; existing publication merges same-day performances into five
  dates. Pinocchio is verified as a pantomime cast role and excluded. Per-source
  hosted outcomes and actual public checks are retained in the report; this is
  not a guarantee of permanent reachability.
- Remaining source gaps have current explicit evidence: blocked/server-error
  access, absent trustworthy dated schedules and unsupported/wrong identity
  bindings. Existing provider coverage does not turn a failed official scraper
  into a healthy one. Antone's proves the loaded month, Paul Halley currently
  lists only archived appearances, and readable sources do not guarantee future
  concerts or complete worldwide coverage. No frozen month/news archive, guessed
  year/country, blanket empty flag or access/security bypass hides these gaps.
- Next concrete needs for 415/415 and 152/152: a current supported calendar or
  provider access for blocked/absent sources, and canonical evidence for ambiguous
  identities. Jorge & Mateus has verified the native current and next UTC months,
  including a genuinely empty preceding hosted result. Both monthly payloads
  are checked on every collection even when the agenda HTML is unchanged;
  other sources preserve their existing conditional-cache behavior. The real
  populated contract, missing venue rejection, source identity and ambiguous
  country cases are covered. This is two-month coverage, not all future months. Those limits are recorded; the current release is published and
  verified, while 100% source health remains unachieved.
- CI on the latest Jorge head: **743 pass / 1 skip / 0 failures**; build, lint and selector gates pass. No artist catalog changes are in this PR, so the conditional artist-integrity step is skipped. Ten targeted/cache checks also passed locally. PR #201 is merged; actual hosted outcome and current/next-month empty evidence are recorded in the report.
- Four existing artist source configurations now use the guarded scraping HTTP client: Marmalade, Paralamas do Sucesso, Astrid Williamson and Lobão. Local official-calendar checks found 2 and 8 future events for the first two, an explicit empty notice for Astrid, and two printed past events with no claimed future coverage for Lobão. The latest full artist manifest records their actual outcomes: marmalade: failed, paralamas-do-sucesso: succeeded, astrid-williamson: failed, lobao: succeeded. Public cards are compared with all ten official event dates and locations; the report explicitly records any missing rows and distinguishes failed fresh collection from cached/provider coverage. CI on PR #202: **743 pass / 1 skip / 0 failures**; build, lint and selector gates pass. Artist integrity is skipped because the artist catalog did not change. These are four access configurations, not four new extractors.
- The All That Remains official Tour page now reads its actual Bandsintown widget. Exact group profile 513 and canonical group MBID are validated independently of the distinct Philip Labonte identity. Native profile count zero plus an actual empty events array establish the current empty calendar; API errors, identity mismatches and incomplete/unknown geography fail explicitly. Linked API requests stay fresh on repeated collection. Latest hosted outcome: succeeded (empty_schedule). Current native future-event count is zero; populated behavior is covered by contract fixtures, not observed future shows. CI: **750 pass / 1 skip / 0 failures**, with build, lint and selector gates passing.
- The newly regressed Dan Deacon source uses the existing guarded scraping client; actual local collection preserves six official future shows with zero processing drops. Latest full artist outcome: succeeded. The source-specific Nitsch provenance guard prevents exhibition periods from becoming single concert dates and quarantines one exact music row without verified artist attribution, including restored caches. Public verification removes those known records; the independently primary-verified Evgeny Kissin recital on 2027-04-30 remains. Latest CI: **753 pass / 1 skip / 0 failures**, with build, lint and selector gates passing. Fresh-source failures, archived raw rows and future concert coverage remain distinct.
- Unresolved calendar-coverage check: Paralamas latest hosted snapshot has eight events, all eight published; the prior official 2027-03-06 Montes Claros event is absent before processing and a new 2026-12-19 Sao Paulo event appears instead. The agenda and exact native event page timed out in current guarded fetches; independent primary web reads also failed. Removal versus unobserved pagination is unconfirmed. The historical-snapshot preservation check is explicitly blocked/not passed, and full calendar coverage is not claimed. No guessed pagination, resurrected date or cache edit hides this gap.
- Published provider health — ticketmaster: healthy, completeness complete; selected 27, attempted 27, succeeded 27, failed 0, unavailable 0, cache fallbacks 0. Full current freshness and actionable access/identity issues remain in finalHostedVerification.publication.sourceHealth. Source-cohort success does not claim complete upstream coverage.
- Published provider health — bandsintown: degraded, completeness partial; selected 800, attempted 800, succeeded 634, failed 0, unavailable 166, cache fallbacks 0. Full current freshness and actionable access/identity issues remain in finalHostedVerification.publication.sourceHealth. Source-cohort success does not claim complete upstream coverage.
- Published provider health — eventbrite: unavailable, completeness partial; selected 5, attempted 5, succeeded 0, failed 5, unavailable 0, cache fallbacks 0. Full current freshness and actionable access/identity issues remain in finalHostedVerification.publication.sourceHealth. Source-cohort success does not claim complete upstream coverage.

## All-branch integration and source recovery — 2026-10-06 (preceding publication; superseded above)

- Alex explicitly requested integrating all branch work into main and repairing
  sources. PRs #182, #183, #186 and #187 are merged. All 63 originally audited
  local/remote branch refs are included; the final refreshed audit checks 64
  current refs plus all 18 frozen remote heads with no missing ancestry. PRs
  #121-125, #161 and #168 are also MERGED. No unique committed local patch remains.
  The original checkout's independent uncommitted `BACKLOG.md` is preserved;
  implementation/release used the attached `all-sources-recovery` worktree.
- The missing canonical The HU identity is added through `artistDb`; ordinary
  canonical matching supersedes the historical branch's frozen ten-observation
  gate. The exact Dublin duplicate preference remains. The final public artist
  file contains 19 shows, all attributed to The HU and its approved official
  website. Public ticket links still follow the project's accepted preference
  for the artist website. Three unique rejected-repair records from PR #161 are
  retained chronologically, without replaying obsolete configurations.
- Dependency updates from PRs #121-125/#168 are consolidated. Compatible
  resolutions remove four high transitive advisories without overrides. The
  lockfile aligns the Google/AI SDK provider types; install, build and the
  zero-vulnerability audit pass.
- Ticketmaster splits crowded future windows, overlaps boundaries, deduplicates
  provider event IDs and preserves last-good country caches on malformed,
  truncated or failed responses. The first hosted pass exposed 27 HTTP 400s;
  it retained all country concerts and verification timestamps. PR #186 uses
  documented second-precision UTC bounds with outward rounding. Twenty mocked
  regressions cover full 1,201-event splits, malformed rows, TBA, empty countries,
  unchanged fallback caches and sanitized structured HTTP 400 diagnostics.
- Final daily run [37481742565](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/37481742565)
  completed collection and Pages deployment successfully on main `cffcd3c`.
  Actual Ticketmaster cache/health/public status agree: 27/27 countries freshly
  verified, healthy/complete, zero failed/fallback/partial, 57,686 raw events
  versus 12,316 before. The log records 445 requests, below the unchanged 750 cap;
  no Ticketmaster HTTP 400/invalid-response/incomplete failures remain. US grows
  999 -> 33,262 and GB 1,000 -> 10,824. FR/PT are valid empty countries. This is
  complete configured-country collection, not proof that the provider lists all
  concerts in the world.
- Public `status.json` generated `2026-10-06T14:59:39.476Z` is byte-identical to
  the final run's saved publication (SHA-256
  `3d5fd2dd0d471699e8e207a31ed7d0f80dc8a37f09cf012d921d7bc03d42d5de`).
  It contains 51,072 published concerts versus 38,944 before: +12,128. Processing
  balances 112,392 raw observations, 51,072 published, 12,529 merged duplicates
  and explicit rejection buckets; publication is eligible/schema 3.
- Hosted artist run [37471384116](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/37471384116)
  completed on `37e8a3e`: 394/415 succeeded versus 372/415 before; 25 original
  failures recovered and three prior successes failed. Emancipator verified 12
  complete future raw rows. Final venues are 121/152 versus 95/149 before: 28
  original failures recovered, two prior successes and three added configs fail.
  Progresja now succeeds; James Pankow, successful in the first post-repair run,
  now returns HTTP 403 and retains its last-good data. Across both cohorts, 53
  of the 97 baseline failures succeed in the latest observed runs; 52 configs
  currently fail, including five old successes and three added sources. The
  first daily's 54-recovery figure is historical and superseded by this slice.
- The source-by-source report `docs/source-recovery-20261006.json` preserves
  local proof separately from latest hosted outcomes. Local recovery found 26
  future schedules, 19 explicit empty schedules and four readable archives;
  the other 48 local cases had access, identity or incomplete-evidence limits.
  These local categories are not claims that every source is currently reachable.
  Astrid Williamson and James Pankow now face HTTP 403. Bassnectar, L. Subramaniam,
  Legs Diamond and Ivar Grydeland return dated archives, not future coverage.
  Ivar's six Australian shows ended June 7; explicit future-year/German-location
  fixtures prove the parser is not restricted to that archive or fallback country.
- Repairs use official HTML/observed widget feeds, exact visible empty notices
  and source-specific rendered/public-response parsing. Hidden empty notices,
  incomplete Emancipator relationships and stale empty-cache hashes found by
  review are fixed and regression-checked. Barby verifies 66 future raw events;
  Sangsangmadang confirms its loaded calendar. No guessed date/year/location,
  blanket empty flag or security-policy change conceals a source failure.
- PR #187 repairs recurring overlong retries: transient/dead-domain/anti-bot
  candidates share a conservative 15-second request, retained politeness and
  jittered backoff budget below the unchanged 90-second source ceiling. All 18
  excessive five-retry configs retain identical URLs/selectors/delays and use
  default two retries. Schema/budget checks pass for 485 static configs; 11
  strategy regressions pass. Alabama's ordinary local runner verifies 12 raw
  events; this is local access, not a fresh hosted artist success. Seven artist
  configs have retry-only edits after their producer run; new hosted retry
  behavior awaits the next ordinary artist sweep. Existing raw observations
  stay usable because all extraction fields remain unchanged.
- Final combined CI: 697 tests pass, one skipped, zero failures; build and lint
  pass (zero errors/103 warnings), selector ratchet passes. Production SSRF
  passes; integrated artist integrity is 144 against unchanged baseline 152,
  and duplicate city/venue selectors 126 against 131. Those local data-audit
  counts precede the final run's automated enrichment commit; they are not a
  fresh audit of every later bot data change.
- Remaining source limits are explicit: Eventbrite's five HTTP 405/CAPTCHA
  failures need authorized supported access; Bandsintown lacks feeds for 159
  attempted identities. Several official pages have no trustworthy full future
  rows or explicit empty statement, or have unsupported artist bindings. Psycho
  le Cému's LIVE page has no dated schedule; its cached news date is not a show.
  Ray Davies redirects to an unrelated site, Ray Scott exposes an unreadable
  Angular shell, and Reality Check's ordinary request returns 429.
- After the verified publication, auto-healing PR #188 changed only operational
  retries for Philippine Philharmonic and Majestic from two to safe three, with
  identical extraction/URLs/politeness. Main `e2fd56c` includes those changes and
  this run's enrichment/history; the exact deployed collection remains `cffcd3c`.
  Their new retry settings need the next ordinary venue collection. This later
  operational delta is not asserted deployed by the earlier run. Next work is
  authorized-access/source-identity evidence for the remaining failures and
  ordinary hosted confirmation of the retry-only deltas; no redundant full
  provider sweep is needed just to restate an unchanged successful observation.

## Collector release verified; location recovery — 2026-09-27

- ✅ PRs #141, #142 and #143 are merged into main (`c021403`, `51d401a`,
  `8d18e43`). Alex explicitly requested merging the collector work, running a
  real cycle and continuing improvements. Provider intervals, request caps and
  artist selection remain protected constraints.
- The explicitly dispatched artist run [36230340345](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36230340345)
  was cancelled at 08:55 UTC on September 26. The scheduled artist run
  [36231223233](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36231223233)
  completed successfully on checkout `734043955561302cc56f75a699490e46bf87f875`.
  Its automatic daily run [36232170686](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36232170686)
  used checkout `9b88c14d7157b0dd14d158b35844a55dc741efaf`, restored all four
  artist cache/manifest keys from `36231223233`, and successfully deployed Pages.
  No second manual dispatch was made. The separate daily read-only heartbeat
  paused itself after this confirmed result, as authorized.
- Public `status.json`, rechecked September 26 at approximately 22:15 UTC:
  schema 3, generated `2026-09-26T09:22:32.961Z`, 39,425 concerts. Artist success
  is 378/415 versus 366/417 before release: 18 previously failed sources now
  succeed, five new failures remain, and one previously failed config was
  retired. The two removed misattributed configs are not counted as recoveries.
  Venues remain 96/147: six recoveries offset six new failures; stale caches
  fell from ten to five. These observations supersede the earlier pending
  hosted-verification notes below, without asserting every source is healthy.
- A38 and GrandWest now verify 66 and 16 raw events; 13 and five respectively
  pass publication filters. SO36 verifies its cached 73 events with HTTP 304;
  26 pass publication filters. A 304 is source verification, not a new response
  body. Eventbrite still fails five requests and stops; its access limitation
  remains unresolved. Ticketmaster reports partial pagination for eight markets.
- Downloaded the actual daily `scraper-reports` into
  `/tmp/concert-cycle-20260926/reports`. Manifests, logs and the public diagnostics
  agree; all global and per-source processing totals balance. Public diagnostics
  exclude samples. Replaying all 67,467 raw records with the run's exact artist
  DB revision and clock reproduces 39,425 published, 558 schema rejects and 530
  `country:too_big` issues. Evidence/scripts live in `/tmp/concert-cycle-20260926`.
- 🚧 Next bounded correction is isolated in `codex/collector-location-recovery-20260927`
  at `/tmp/concert-location-recovery-20260927`, based on main `b5dc822`.
  Amorphis and UB40 put the same combined location in both city and country;
  their 68 and 40 raw records all fail validation. Source-specific parsers now
  split explicit country labels, preserve other fields, and reject unknown,
  conflicting or ambiguous regions. The global normalizer stays strict.
  Root owns integration, replay and docs; senior debugger owns the two source
  adapters and the related cache invalidation fix. A changed parser config must
  not reuse old parsed rows via 304 before the corrected parser can run.
- Initial checks: 79 focused source/country/custom-parser tests and build pass.
  Both official sites received one ordinary GET: Amorphis returned HTTP 200 but
  the body timed out; UB40 returned 403. The source-shaped fixtures and raw-data
  replay are explicitly offline evidence; complete live HTML extraction is still
  unverified. No access bypass, extra sweep or parser-default country guess.
  Remaining release checks and final deduplication delta are pending.

## Source-specific recovery and retired-cache safety — 2026-09-26

- Alex approved the full repair/release/normal-cycle verification plan with
  “Все делаем”. Work remains isolated in `codex/collector-source-repairs-20260926`
  at `/private/tmp/concert-live-fix.XPYzJe/source-repairs`; shared main is untouched.
  Root owns integration/docs and release, senior debugger A38/GrandWest repairs,
  another senior debugger the artist-cache ingestion guard, reviewer read-only
  data-safety checks. No broad provider sweep or limit increase.
- A38: previous layout extracted zero events; current official program rows
  yield 66 on saved full HTML. Exclude cancelled and existing house-series rows,
  retain old eventCard support. Previously cached 66 events included 27 future
  dates, with a 51-day-old observation. GrandWest: the old JSON endpoint now
  returns 404 HTML; its current official `/grandwest/events` page yields 16 cards.
  Previous cache was 65 days old, with 11 future dates. Raw multi-date labels
  still use the existing single-date pipeline; no speculative expansion here.
  Evidence: `/tmp/a38-live-20260926.html`, `/tmp/grandwest-events-live-20260926.html`.
- Alabama Symphony: remove the five-retry override, retaining standard two retries
  and 2,000 ms spacing. Six 15-second attempts plus backoff already exceed the
  90-second source deadline; this removes the known excessive retry budget, not
  an assertion that external connectivity is repaired. Existing selectors were
  confirmed against the official page by the diagnosis pass.
- Retire only `artist-your-smiling-face` and `artist-youre-all-i-wanna-do` scraper
  configs: both attributed the James Taylor schedule to a different name. Files
  are recoverable from Git; canonical `artist-james-taylor` remains. Artist DB
  entities are not deleted: a wrong website binding does not establish that an
  artist identity is invalid. Existing `tourScraperTriedAt` fields prevent ordinary
  extraction from automatically recreating these configs; website metadata needs
  separate identity verification before future rediscovery/reset.
- Daily ingestion now excludes artist-cache IDs with no remaining config. It
  preserves last-good entries for active failures, follows usable config IDs
  across filename changes, and retains malformed JSON's safe filename fallback.
  Directory/read errors stop the run explicitly rather than silently dropping
  coverage. Cache files are not deleted or rewritten by this guard. On the saved
  real cache, 391 -> 390 entries: only the one `Your Smiling Face` raw duplicate is
  excluded; the other retired config has no cache. Canonical James Taylor is kept.
- Eventbrite limitation confirmed at 2026-09-26 06:19:05 UTC: HTTP 405 with
  `x-amzn-waf-action: captcha`, Human Verification body, and GET in Allow. This is
  AWS WAF CAPTCHA, not a wrong method. Evidence `/tmp/eventbrite-headers-20260926.txt`
  and `/tmp/eventbrite-body-20260926.html`. No protection bypass, false healthy
  label, or paid integration was introduced.
- Red/green evidence: two source-recovery regressions fail before repair and pass
  after it; 81 targeted custom/source/security tests passed. Five cache-membership
  regressions pass (initial four failed before filtering). Build, focused lint,
  schema checks and diff-check passed. Root's combined source/custom/cache/pipeline
  run passed 112 tests; build and scoped lint passed (0 errors, 2 existing warnings).
  Independent review found no blocking issues. Selector ratchet remains 131/131.
  Hosted source recovery remains unverified until the next ordinary collection.

## Confirmed collector failures — recovery, 2026-09-26

- ✅ Confirmed code defects fixed locally; hosted source recovery remains unverified.
  Alex explicitly requested diagnosis of real degradation followed by fixes.
  This is separate from the labelled synthetic dashboard preview. Base `c8f1f0a`
  (iteration 1, PR #141); isolated branch `codex/collector-recovery-20260926`
  in `/private/tmp/concert-live-fix.XPYzJe/worktree`. The concurrently released
  checkout is untouched. Initial local handoff had no publication or provider sweep.
  Alex subsequently approved the full release and source-recovery plan with
  “Все делаем”; release preparation now uses the current main (`68d2d37`).
- Fresh evidence: published status generated `2026-09-25T09:38:24.515Z` reports
  39,711 concerts, venue 96/147 successful with 10 stale caches, artist 366/417
  successful. Daily run [36119104354](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36119104354)
  and artist run [36117069512](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36117069512)
  both completed successfully despite these source failures. Downloaded existing
  `scraper-reports` artifact (10856307237), not a new collection, into
  `/private/tmp/concert-live-fix.XPYzJe/reports` for offline reproduction.
- Failure breakdown: venue 38 selector/empty-result failures, 9 fetch errors,
  1 client-rendered page and 3 parse errors; artist 21 parse errors, 15 selector/
  empty-result failures, 15 fetch errors. Counts are per cohort, not unique sites.
  Eleven artist parse errors explicitly reject existing `::attr(...)` selectors.
  SO36 fails because its JSON response is auto-decoded before its text-based
  custom parser. Eventbrite makes five HTTP 405 requests in approximately 0.3 s,
  collects zero artists and falls back to 23 cached raw events. Daily processing
  rejects 618 records at schema validation; most errors concern country length.
- Implemented bounded local corrections: preserve strict country validation while
  recovering unambiguous representations; support terminal attribute extraction;
  preserve raw response text for custom JSON parsers; count failed Eventbrite
  requests against its existing cap and retain spacing after failures. Root owns
  Eventbrite/integration/docs, senior_debugger country normalization/tests,
  implementer runner/tests, reviewer read-only correctness checks. API limits,
  source selection, schedules and security protections are not relaxed.
- Remaining live limitations: HTTP 405/access restrictions, unavailable hosts,
  stale/invalid per-site configs and finite sweep capacity are not resolved by
  these code corrections. No source is relabelled healthy without a successful
  check. Recovery counts from saved data are offline evidence, not newly scraped
  concerts or proof of published improvement.
- Saved artist-cache replay (11,974 raw records, fixed clock
  `2026-09-25T09:35:00Z`, identical approved artist DB): 2,375 -> 2,492 accepted
  identities, exactly 117 added / 0 removed / 0 changed using the production
  artist/date/city dedupe key. Zod rejects 615 -> 498; oversized country fields
  590 -> 473. These are artist-cache-only counts, not the whole daily dataset.
  Invalid `PO`/`KO` are now rejected; their historical fixtures were already past
  dated, so they do not affect this accepted-set delta. Remaining malformed
  fields are not guessed. Replay script and baseline/current/delta JSON are at
  `/private/tmp/concert-live-fix.XPYzJe/replay-country-loss.mjs` and
  `/private/tmp/concert-live-fix.XPYzJe/country-replay-{baseline,current,delta}.json`.
  Delta SHA-256: `bf004d4d6b4a7e493757cf4d5dc9294fc9ec48b147a0e1b2cd7f246e831cfe39`.
- Final root checks: 59 country/pipeline/processing/Eventbrite/source-health
  tests PASS; three loopback selector/raw-JSON tests and one SSRF policy test
  PASS; `npm run build` and `git diff --check` PASS. Scoped ESLint has no errors,
  only existing warnings. Independent review found the non-ISO code issue above;
  it was corrected and regression-tested, with no remaining blocking findings.
  The initial full runner attempt was blocked by port 8130. Its owner confirmed
  and stopped that previous test process. A further run exposed a real launch
  failure deadlock: getBrowser caught a rejected launch, then awaited closeBrowser,
  which awaited the same pending promise. A deterministic test reproduced the
  timeout; failed launches now clear their shared promise and allow a later retry.
  Compatible Chromium 1243 was installed. The full test suite, including the real
  Playwright-render case, then passed on Node 22; production SSRF policy separately
  passed without the localhost override. Full lint: 0 errors, 109 existing warnings;
  build and diff-check passed. No test/security check was weakened.
- Tested base `c8f1f0acb2597c0063371dd12b54e8142593b067` plus seven code/test
  paths: `src/engine/{eventbrite,runner}.ts`, `src/pipeline/process.ts`, and
  `tests/{eventbrite,country_recovery,selector_attr_recovery,custom_json_response}.test.ts`.
  SHA-256 over sorted path + NUL + bytes + NUL:
  `e3e05f5e0f97a2efc478b44c97a810d0fdd580924bb494cc6320b20e3828d8bc`.
  This hash identifies the original seven-file patch, before the additional
  browser lifecycle fix and its regression test. Release-owner coordination is
  complete. Next: release through PR/CI, then verify a normal hosted collection
  before claiming improved public coverage. Individual broken-site configs/access
  failures require source-specific recovery evidence.
- Coverage assessment on the same saved Bandsintown cache: 20,738 artists,
  including 3,808 with future events. Active-cache verification age p50 11.01 days,
  p95 19.06, max 20.07; 2,781 active artists were older than six days. The 800/day
  cap requires at least 26 runs for one whole-pool pass. Existing 20% active
  reservation and all provider limits are unchanged; a freshness-priority change
  remains a separate product decision after hosted recovery is measured.
- Released via [PR #142](https://github.com/Cartograf666/concert-for-travelers-api/pull/142)
  at 2026-09-26 06:35:47 UTC, merge `51d401a2a09010445a0a76a9cb5eabd8822c7a7c`.
  Remote main tree equals tested head `4ee3b4a50b9259b15e6c8dec193ec412f71c2e61`.
  [CI run 36223713753](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36223713753):
  551 passed, 0 failed, 1 harness-only SSRF skip (separate production-policy test
  passed locally). Build/lint and 131/131 selector ratchet passed; no review
  comments. Ordinary hosted collection/publication verification still pending.

## Collector clarity and freshness — iteration 1, 2026-09-25

- ✅ Merged via PR #141; hosted collection validation pending. Alex
  approved this iteration with “Давай”, after explicitly preserving
  provider-driven request intervals and limits. Scope: integrate existing local
  queue/checkpoint work, expose source verification/cache age in the existing
  status/dashboard, and diagnose normalization rejects. No scheduling, caps,
  artist selection, normalizer behavior, event identity or consumer-app changes.
  Root owns orchestration/status/dashboard/workflows/docs; source worker owns
  engine diagnostics and artist orchestration; processing worker owns diagnostic
  counters/examples. Existing dirty work is protected.
- Current baseline: safely fast-forwarded `main` from `04af08f` to `3607bf7`;
  remote changes were confined to data/configs. Full local tracked patch and all
  five untracked files preserved byte-for-byte; backup under
  `/tmp/concert-iteration1-before`. These checks established the local working
  version before release; no live collection was run for them.
- Implemented `status.json` v3 with backward-compatible flat/cohort fields,
  per-source verified age, fallback/empty/unavailable/partial counts and actions;
  artist reports persist with the existing manifest cache. Successful 304 checks
  advance verification while keeping the content observation time. Legacy cache
  remains unknown; failed/skipped outcomes cannot fabricate recovery. Ticketmaster
  pagination limits remain unchanged and are explicitly partial, not fully verified.
  Publication `eligible` means gate eligibility, not a confirmed Pages deployment.
- Processing reports account for input, accepted, duplicate and rejected records
  by source/reason/field without changing normalized output. Bounded samples stay
  in workflow artifacts; public status contains aggregates only. The existing
  dashboard now exposes these reports, missing/old states and diagnostic actions.
- Verified 2026-09-26: 131 distinct targeted tests passed (29 queue/checkpoint,
  29 processing/pipeline, 48 source/cache, 12 Ticketmaster loopback, 13 dashboard/
  workflow). `npm run build` passed; scoped ESLint had no errors, only existing
  type-import warnings. Maintained `kjanat/actionlint` 1.17.0 passed workflow lint;
  OpenAPI YAML parsed; `git diff --check` passed. Independent reviewer findings
  on 304 staleness and Eventbrite skipped counts were fixed and regression-tested.
- Browser checks: actual dashboard at 1280 and 390 px; source/processing details
  and country expand/collapse work; no horizontal page overflow, no browser errors.
  Preview at `http://127.0.0.1:8765/dashboard.html` uses explicitly labelled test
  reports and a saved 2026-09-24 event snapshot, not live health measurements.
- Tested base `3607bf77a9776e05fa3697d0ad9222c5c6f384a0` plus working changes;
  SHA-256 over sorted changed code/test/workflow/dashboard/README/OpenAPI paths
  and bytes (path + NUL + bytes + NUL):
  `ae262b874ca97629a4a3cfe86963a020facafaf223e470b1ed1aead2a6e76305`.
  Exact 41-file list/check summary: `/tmp/concert-iteration1-evidence.json`.
  At that local handoff no commit, push or deployment had occurred. Hosted cache
  transport, checkpoint durability after hard kill and improved live data coverage
  remain unverified; local tests are not evidence of those outcomes.
- 2026-09-26 continuation: Alex gave positive feedback and asked to continue.
  Release preparation is on `codex/collector-health-20260926`, based on `c2a8a0e`.
  Upstream changes since the tested baseline were data-only; the full tracked
  patch and all 10 untracked files were preserved byte-for-byte. Implementation
  hash above was unchanged before a staged whitespace-only cleanup. Prepared a
  PR for the existing full GitHub gates;
  no extra provider sweeps or changed request schedules are needed for CI.
- Released 2026-09-26: [PR #141](https://github.com/Cartograf666/concert-for-travelers-api/pull/141)
  merged at 06:02:53 UTC as `c021403b6fbfba720947adb28e8601828d8bef42`.
  Verified remote main and zero code/test/workflow/dashboard/API-doc diff from
  tested PR head `c8f1f0acb2597c0063371dd12b54e8142593b067`.
  [Full CI](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36222253752):
  build/lint passed, 538 tests passed, 1 production SSRF test intentionally skipped
  under the localhost test harness. That test separately passed via
  `npm run test:ssrf-policy`; selector ratchet remained 131/131. Artist-data ratchet
  was correctly not applicable (PR did not modify the artist database).
  [Workflow lint](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36222253763)
  also passed, including the hosted pinned validator supporting `queue: max`.
  Main has no branch-protection rule; merge was explicitly pinned to the verified
  PR head. No manual collector dispatch was added. Next verification is the
  ordinary artist → daily → Pages cycle and its source reports; code rollout
  alone does not establish fresher events or improved coverage.
- Separate recovery work is isolated in `codex/collector-recovery-20260926`
  under `/private/tmp/concert-live-fix.XPYzJe/worktree`. Its source/parser fixes
  were not included in this release; that task owns its checks and delivery.

## Artist discovery calibration — 2026-09-11

- ✅ **Offline calibration, not a shipped filter.** Alex accepted the proposed
  calibration-first step on 2026-09-11 and delegated the choice of trend/era/
  generation approach. Root owns package/docs integration; implementer owns
  `src/scripts/calibrate_artist_fame.ts` and its test. That first step left the
  artist DB, acquisition tier, publisher, workflows and consumer app unchanged.
  Three fixed listener-threshold candidates evaluated on 63,331 DB rows and
  42,256 concerts; missing metrics remain unknown. Full examples, input hashes,
  commands and limitations: `docs/ARTIST-DISCOVERY-CALIBRATION.md`.
- ✅ **Accepted and implemented locally on 2026-09-11:** Alex's follow-up “это делаем
  касательно калибровки по популярности” approves the proposed balanced 1m/100k/10k
  accumulated Last.fm listeners. Top two groups retain 30,488 concerts (72.2%).
  Working labels describe audience size, superseding the earlier proposed
  “superstars/world fame” semantics: regional and profile-level biases persist.
  Trend, peak era and generation labels remain unsupported, not guessed from
  a snapshot, formation date or presumed age-based tastes.
- ✅ **Checks:** build, 4 focused tests, scoped eslint and real CLI report pass;
  root corrected all-mode accounting and checked final aggregate/cohort results.
  Tested base `b0c4c9e` plus the new calibration files/package command; TS hashes
  retained in the report document. DB unchanged in final diff. No deployment.
- ✅ **API integration contract:** implementer owns shared discovery schema/helper,
  concert schema, matcher/process, publisher/changelog and their tests; root owns README,
  OpenAPI and this state. Catalog `discovery` and concert `artistDiscovery` must
  agree for the actual matched DB entry, including aliases. Version 1 describes
  accumulated Last.fm audience with unknown metric date; no temporal/demographic
  claims. Protected: artist DB, acquisition tiers, source acquisition, workflows
  and the separate app. No backend filtering or network dependency. Verified:
  backward-compatible parsing, category boundaries, full/page/artist/city feed
  shapes, new changelog entries, alias-row consistency and no-loss behavior for
  small/unknown audiences. Historical changelog entries may omit the profile.
  Consumer integration documented in README/OpenAPI; feed schema version is 2.
  `npm run build` pass; `npm run test:no-playwright` 474 pass/1 skipped/0 fail
  (log `/tmp/concert-fame-api-tests.log`); scoped eslint 0 errors/11 existing
  warnings; OpenAPI YAML parsed, catalog required field and three refs checked
  with Ruby YAML. No browser
  or live-provider tests for this change. Full-data recalibration passed unchanged.
  Reviewer found the separate changelog path missing the profile and the catalog
  OpenAPI required field missing. Both fixed; bounded repeat review found no
  remaining issues. After that fix: build plus 9 discovery/changelog tests and
  changelog scoped lint passed. The 474-test run preceded this isolated fix;
  unaffected evidence retained, affected paths rerun (full suite not repeated).
  Tested HEAD `b0c4c9e` plus final working tree: combined SHA-256
  `b17e5b81de760d00d1be1ab8451c66e33879eea263c7be6bb08d6841cc07edca`
  over sorted path+NUL+bytes+NUL for the two new discovery modules, concert schema,
  process, publisher, changelog, calibration CLI, their five test files and package.json.
  Release authorized by Alex's follow-up “выполни тогда” on 2026-09-11.
  PR #111 passed GitHub verification and was squash-merged as
  `04af08fe3e2cb53562281177e6e6a39c80533242`. Publication run `34624663345`
  succeeded. Live smoke: index schemaVersion 2, lastRun 2026-09-11T17:04:14.022Z;
  all 42,258 concerts and 62,941 catalog entries carry their discovery profiles;
  all 25 currently published change entries do too. GitHub warned of 8 stale
  venue caches (source freshness issue, not release failure). No rollback needed.
  Human relevance/precision and a default restrictive UI filter remain unverified.
- ✅ **Consumer integration implemented and locally verified:** the separate app at
  `/Users/alex/code/concerts-for-travelers` propagates strict v1 discovery profiles,
  soft-migrates legacy Cartograf caches with last-good fallback, and offers
  All/top 2/top 3 audience filtering in region browsing. Favourites bypass only
  audience filtering; missing/unsupported profiles remain unknown. The control
  is a form draft until submit to avoid resetting other unsaved parameters.
  Final client/server build passed; 11 client and 53 server focused tests passed;
  repeat review closed draft-reset and concurrent migration-write defects.
  Live local browser: Germany 2026-09-18–2026-10-03 gives 204/264 (top 2),
  246/264 (top 3), then 264 (All); form and map visually inspected. A source
  failure warning remains visible; no full-coverage claim. Exact app input hash
  and checks are retained in its existing destination-discovery plan milestone.
  Existing dirty work preserved. App changes are not committed, pushed or deployed;
  visual acceptance and app publication remain separate from the completed API release.

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
- 🚧 **`artist-db-write` pending-slot loss: local native-queue fix prepared;
  workflow validation blocked, not released.** Package
  `vacation-20260917-concert-queue-recovery-01`, authorized by Alex through the
  vacation coordinator on 2026-09-17 (local changes only). Root owns integration
  and this status; one senior-debugger writer changed the workflow/test paths.
  Existing unrelated BACKLOG changes are retained, not included in a commit.
  Decision: ADOPT GitHub's native `queue: max`, preserving the shared group and
  `cancel-in-progress: false`; no custom recovery service/dispatch loop.
  [GitHub documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
  and [2026-05-07 announcement](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/)
  establish one active writer and up to 100 pending requests. This supersedes
  the assumption that GitHub only supports one pending slot. All 12 members
  opt in uniformly: `.github/workflows/{daily-scrape,data-hygiene,discover-tour-urls,
  enrich-auto,enrich-database,enrich-images,enrich-metadata,enrich-similar,
  extract-tour-scrapers,integrity-baseline-refresh,prune-dead-scrapers,self-heal}.yml`.
  Daily scrape retains its job-level lock; Pages concurrency is unchanged.
  `src/scripts/check_concurrency_drops.ts` now guards direct execution so tests
  can import the workflow list without invoking gh or writing drop history.
  `tests/artist_db_queue.test.ts` checks actual configuration plus an explicit
  model of documented scheduling semantics; it is not a hosted GitHub emulator.
  Before the fix two regression assertions failed; after the fix five scheduled
  slots and neighbouring writers survive contention and drain once per request.
  Import safety, single-writer configuration and 100-slot overflow are covered.
  Root verification (same checkout, 2026-09-17):
  `node --import tsx --test tests/artist_db_queue.test.ts tests/concurrency_group_coverage.test.ts tests/optimization_workflows.test.ts tests/reapply_artist_db_delta.test.ts tests/reapply_tour_url_audit_delta.test.ts`
  **14/14 pass**; `npm run build` pass; scoped eslint on changed TS pass;
  `git diff --check` pass. Writer's full `npm run lint`: 0 errors, 110 warnings.
  Independent reviewer found no blocking code defect; confirmed 7 targeted tests.
  **Failed gate:** installed actionlint 1.7.12 rejects `concurrency.queue` in
  all 12 files. The pinned CI action `d290e336d5a743810aef4404f757dc862276d2ae`
  also installs 1.7.12. [Upstream issue #680](https://github.com/rhysd/actionlint/issues/680)
  documents this unsupported official syntax. No suppression, gate weakening or
  validator patch added. Full changed-workflow lint also reports SC2016 in the
  unchanged extract-tour-scrapers shell body. Do not describe workflow lint as green.
  Read-only live history found scheduled cancellations (e.g. image enrichment
  run `33973383336`, 2026-09-05; metadata `32217146719`, 2026-08-19), with no jobs;
  their cause annotations are unavailable, so queue-preemption is not proven for
  these specific runs. An empty local drop log does not disprove the defect.
  Tested input: HEAD `04af08fe3e2cb53562281177e6e6a39c80533242` plus local changes;
  sorted path+NUL+bytes+NUL SHA-256 of the 12 workflows, watchdog and new test:
  `2bf5ceb9d332e1dec778e16acbffe62e1a59be69ea18625e3237dcaf6cb30ef0`.
  Protected artistDb/data shards/delta/checkpoint paths and consumer app unchanged.
  No commit, push, schedule activation, dispatch, enrichment batch or deployment.
  Stop: bounded local package handed off with validator compatibility blocker.
  Next: resolve supported workflow validation without weakening checks, then
  separately authorize publication and observe hosted queue behavior. This patch
  prevents future pending replacement after adoption; it does not replay historic
  cancellations, recover missed cron triggers, or guarantee against >100 backlog
  overflow/manual cancellation. Existing watchdog and daily manual retry remain.

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
- ✅ **Workflow queue validator compatibility fixed locally; unpublished** —
  `vacation-20260922-concert-validator-04`, 2026-09-22. Supersedes the local
  actionlint compatibility blocker recorded in packages 01–03, not their hosted
  verification limits. Branch main, HEAD `04af08fe3e2cb53562281177e6e6a39c80533242`;
  existing dirty packages preserved. Only this entry and two workflows changed.
  `.github/workflows/lint-workflows.yml` now pins reviewdog/action-actionlint
  v1.76.3 commit `23bcc6aa6e2ccffe1e7730111b98ddcaf34cb098`, whose official
  installer uses maintained `kjanat/actionlint` 1.17.0. This is an explicit
  validator-provider change adopted by reviewdog, not a custom fork/patch here.
  Fresh GitHub API checks found rhysd latest still 1.7.12 and PR 654 unmerged;
  upgrading only within that provider would not fix queue support. New action's
  immutable image: `sha256:4f5436c518b7d60d795e58b5fa57f2c190d08abda04e203264d28554905af8e4`.
  Gate explicitly sets `filter_mode: nofilter`, `fail_level: any`; previous
  defaults did not enforce nonzero exit for findings. No ignored rules, stripped
  queue keys, disabled external linters, or changed triggers/counts. Existing
  reporter/token permissions preserved; hosted reporting/permissions not tested.
  `.github/workflows/extract-tour-scrapers.yml` report now uses quoted heredoc
  instead of a shell single-quoted JS argument, resolving existing SC2016 without
  suppression or JS changes. Before/after report execution returned identical
  output and exit 0 against current local data (read-only).
  Verification: old `actionlint -oneline` on 12 writer workflows FAIL (12 queue
  errors plus SC2016); new 1.17.0 `actionlint -oneline` across the entire project
  PASS after heredoc fix. Actual-parser negative fixtures reject invalid queue,
  unknown concurrency key and invalid expression with exit 1; real discover
  workflow passes with exit 0. `git diff --check` PASS. No application code
  changed; application build/tests not rerun. CI Docker/GitHub runtime not run.
  Local binary downloaded to `/private/tmp/concert-validator-04.4Ku46G`;
  darwin-arm64 release archive SHA-256 matched GitHub asset digest
  `f123b7ad57a0fe376dcc85e81b7e04e85eb39219184803fc25f989b255f569b4`.
  System Homebrew actionlint remains 1.7.12; use the checked 1.17.0 binary for
  equivalent local validation. Final file SHA-256: lint-workflows.yml
  `ee18874f4e0a5a436a38cd9ed7e439e7ea7326918218a232ef2bfc3873f503a0`;
  extract-tour-scrapers.yml (includes preserved prior queue addition)
  `fb5879c6fb8625817b4a81901d5677d3ec3b3fb9189976b8920d56966d6d1e60`.
  Sources: [reviewdog release](https://github.com/reviewdog/action-actionlint/releases/tag/v1.76.3),
  [pinned installer](https://github.com/reviewdog/action-actionlint/blob/23bcc6aa6e2ccffe1e7730111b98ddcaf34cb098/scripts/install-actionlint.sh),
  [validator release](https://github.com/kjanat/actionlint/releases/tag/v1.17.0).
  No commit, push, deployment or enrichment. Stop after this package; publication
  and hosted verification require separate authorization.
- ✅ **Local cross-runner discovery integration verified; unpublished** — package
  `vacation-20260917-concert-runner-checkpoint-03`, 2026-09-17. Supersedes package
  02's deferred local workflow integration, not its unverified hosted durability.
  Changed `.github/workflows/discover-tour-urls.yml`, added
  `src/scripts/tourUrlDiscoveryRunner.ts`, exported a narrow validation hook from
  `src/scripts/tourUrlDiscoveryCheckpoint.ts`, added
  `tests/discover_tour_urls_runner.test.ts`. Single writer: senior_debugger; root
  reviewed integration and owns this status. Checkout uses current main. Guarded
  finalizer exports after success or ordinary failure; existing shared composite
  commits DB, audit and `data/tour-url-discovery-state/checkpoint.json` together.
  Restore validates the envelope against fresh DB/audit before restoring the
  unchanged cursor/pending journal; it never restores an old DB snapshot.
  Delta replay skipping a conflicting row fails restore explicitly, including
  completed journals; manual changes to checked own fields/catalog identity also
  require resolution. Fresh neighbouring fields remain protected.
  Durability starts at confirmed remote push, not every local slice. Cancellation
  finalization is best effort; hard kill/runner loss before push can lose all new
  local slices, leaving only the last confirmed export. Hosted execution untested.
  Verification: `node --import tsx --test --test-reporter=dot tests/discover_tour_urls_runner.test.ts tests/discover_tour_urls_checkpoint.test.ts tests/discover_tour_urls.test.ts tests/reapply_artist_db_delta.test.ts tests/reapply_tour_url_audit_delta.test.ts tests/optimization_workflows.test.ts`
  **45/45 PASS**, including eight runner tests: disposable runtimes, pending audit
  recovery, failed transport, corrupt/incompatible restore, exact delta conflicts
  and local adapter CLI. `npm run build`, scoped ESLint on adapter/helper/new test,
  and `git diff --check` PASS. Actionlint on discover workflow remains **FAIL**:
  installed 1.7.12 rejects prior package's `concurrency.queue`; no suppression.
  HEAD `04af08fe3e2cb53562281177e6e6a39c80533242` plus working tree; sorted
  path+NUL+bytes+NUL SHA-256 of the four package paths listed above:
  `1056cb212adcdda6a49629b7e5b656658f048757a30db98ad22e114d93d30662`.
  Prior package hashes below describe their historical verification, not this
  combined revision. Shared composite/storage, production data, other workflows,
  selection/security rules, schedule and counts unchanged by this package.
  No real enrichment, commit, push or deployment. Final quota check: 6% remaining,
  above 5% reserve; no reset. Stop here; no next package started.
- ✅ **Local discovery checkpoint/resume implemented and verified** — package
  `vacation-20260917-concert-discovery-checkpoint-02`, coordinator authorization
  2026-09-17; not published. Single code owner: senior_debugger; root integrates
  and maintains this status. Changed `src/scripts/discover_tour_urls.ts`, narrow
  `src/scripts/tourUrlDiscoveryCheckpoint.ts`, and
  `tests/discover_tour_urls_checkpoint.test.ts`. CLI modes and default 60 retained;
  selection/tier/SSRF/redirect rules and shared DB/delta architecture unchanged.
  Completed ten-candidate slices are atomically journaled before advancing.
  Run applies each saved slice to freshly loaded DB; write-ahead intent and stable
  audit IDs let resume finish DB/audit boundaries without re-probing persisted
  slices, duplicating audit, or overwriting fresh neighbour/tour fields.
  State paths: `probe` uses `<resultsFile>.checkpoint.json`; `apply` uses
  `<resultsFile>.apply-checkpoint.json`; `run` uses
  `data/tour-url-discovery.checkpoint.json`. Keep these with the working copy.
  Repeat the same command to resume. An unfinished run freezes its candidate
  snapshot/limit; added candidates wait for the next batch. A completed run starts
  a new batch (a different limit is then allowed). Completed probe/apply with the
  same input are idempotent. Changed input/website/name multiplicity, bad digest or
  unknown state version fail closed: inspect and explicitly move the sidecar aside
  only when intentionally abandoning/restarting that work. Initial ambiguous names
  retain the no-guess skip policy; durable skips never become false probe misses.
  Verification on final inputs: `node --import tsx --test tests/discover_tour_urls_checkpoint.test.ts tests/discover_tour_urls.test.ts tests/artistDb.test.ts tests/reapply_artist_db_delta.test.ts tests/reapply_tour_url_audit_delta.test.ts tests/optimization_workflows.test.ts`
  **45/45 pass**, also repeated with `--test-reporter=dot`; `npm run build`,
  `npx eslint src/scripts/discover_tour_urls.ts src/scripts/tourUrlDiscoveryCheckpoint.ts tests/discover_tour_urls_checkpoint.test.ts`,
  and `git diff --check` pass (existing ESLint package-module notice only).
  The 16 new tests include interruption after one slice, each durable boundary,
  an actual second-shard rename failure, fresh-field preservation, audit/probe
  idempotence, skipped-result recovery, rename failure before checkpoint commit,
  invalid state/input, and real CLI probe/apply subprocesses with fetch disabled.
  Initial slice test failed before implementation. Independent reviewer identified
  a persisted-skip eligibility bug; fixed and regression checked, no remaining
  blocking findings. Root checked final combined inputs after that review.
  Tested HEAD `04af08fe3e2cb53562281177e6e6a39c80533242` plus working tree;
  sorted path+NUL+bytes+NUL SHA-256 of the three changed/new code/test files:
  `8bbb5448c8c0c384bca5a7df52cb9e85b13cbea00396b9aee5e7fe954d8cfaca`.
  Production data and protected queue package untouched; its fingerprint remains
  `2bf5ceb9d332e1dec778e16acbffe62e1a59be69ea18625e3237dcaf6cb30ef0`.
  Limits: existing single-writer and surviving local disk required; in-flight,
  not-yet-journaled probes may repeat. Power-loss durability of existing DB storage
  and recovery after runner disposal are not established. Existing workflow only
  commits after success and does not retain the journal across GitHub runners;
  that integration/publication needs a separate authorized package. The earlier
  "not cron'd, 60/9,228" text was stale: inspected workflow already has daily cron,
  dispatch default 300 and scheduled fallback 800; no schedule/count changed here,
  no new live candidate-count claim. Previous actionlint FAIL remains unresolved
  and was not retried. No real probing/DB writes, commit, push or deployment.
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
- `docs-ru/` is a one-time Russian translation snapshot (2026-07-21) of the
  main docs, made on request — it is NOT kept in sync going forward. Don't
  update it when editing the English originals; if it drifts noticeably
  stale, that's expected, not a bug.

## Remaining collector recovery — 2026-09-27

- Alex requested implementation of the remaining recovery plan, access checks
  up front, and completion reporting. Work is isolated in
  `codex/collector-remaining-recovery-20260927` (base `1ef38d6`); shared main and
  the sibling Amorphis/UB40/cache-invalidation worktree are protected. Root owns
  integration and a single post-release collection; no duplicate dispatches.
- Current baseline: scheduled artist run `36310041552`, daily/Pages run
  `36311090978`, actual daily checkout `72a552035cc49bf4e6eb3a98b40d225c575fe09c`.
  Public status generated `2026-09-27T10:09:52.496Z`: 38,847 published concerts,
  venue 97/147 successful, artist 371/415 successful, 520 country-length rejects.
  Full artifact replay with the exact checkout's artist DB and **TZ=UTC**
  reproduces all totals: 66,265 raw, 38,847 published, 546 schema rejects.
  Evidence lives in `/tmp/concert-cycle-20260927`; replay is not a new collection.
- Sabaton now extracts the country label without its nested city/state. This
  prevents Maryland's `MD` from being interpreted as conflicting Moldova
  evidence. The official page still yields 75 rows. Full-array source replacement
  adds exactly one National Harbor concert, removes none, and changes no existing
  published fields except observation timestamps. Regression red/green confirmed;
  missing country labels are rejected instead of using Sweden as a fallback.
- Eventbrite reports an explicit AWS WAF CAPTCHA/challenge header as
  `access_challenge` with `obtain_authorized_source_access`, not an HTTP-method
  repair. Genuine 405/429/format errors retain their existing classification.
  Request budgets, pacing, cache retention and verification timestamps are
  unchanged. This does not restore Eventbrite access. Official public event
  search is deprecated; a generic API key does not replace a licensed feed.
- Insomnium and Beth Hart use source-specific location extraction. The wrong
  `artist-insomnia` config is retired because it attributed Insomnium's official
  schedule to another artist. Its DB identity and on-disk cache are preserved;
  existing active-config filtering excludes that cache from publication. Removed
  misattributed rows are not counted as recovered concerts.
- Akvárium recognizes the official abbreviated month labels and displayed years;
  Majestic retains its existing selectors and lowers its excessive retry override
  to the standard two retries. Direct official-page checks yielded 97/16 raw and
  12/7 approved future concerts respectively, not a measured net catalogue gain.
- External failures remain explicit: Barby and Yugong challenge automated access,
  Esplanade has a TLS certificate mismatch, and RUST returns HTTP 455. KT&G needs
  a date-aware supported endpoint integration; no fixed-month URL, TLS bypass,
  CAPTCHA bypass, relaxed country validation or assumed recovery was introduced.
- Amber Run and Barbara Dickson now separate their source-provided city and
  country fields. Emancipator uses explicit observed US/Canadian regions and
  suppresses just-ended yearless ranges without dropping next-year dates. Its
  fixture/cache checks passed, but a full live HTML fetch timed out; it is not
  included in the measured live-capture replay gain.
- Combined full-array replacement of the saved live captures yields 38,841
  published concerts: 45 added keys and 51 removed malformed Insomnium city keys.
  All 51 removed keys remain represented by the same artist/date after city
  correction and deduplication; this is not a loss of 51 performances. Country
  length rejects fall from 520 to 389 and total schema rejects from 546 to 415.
  This excludes the sibling Amorphis/UB40 patch and fixture-only Emancipator.
- Local checks: 572 tests passed, one skipped; production SSRF-policy test,
  TypeScript build, lint (zero errors), diff check and independent review passed.
  Duplicate city/venue-selector audit: 130 offenders, within the 131 ratchet.
- In progress: sibling cache-invalidation integration, CI/release, then actual
  publication verification. The cache guard covers configuration and direct
  custom-module bytes, not shared helper/runtime changes. Local replay and green
  checks alone do not establish hosted recovery.
- Release blocker found after the source-parser review: on the combined replay,
  86 surviving keys lose start time, 84 lose coordinates and two lose venue kind
  through first-wins deduplication. PR #150 must not ship alone. The companion
  patch owns duplicate selection; combined replay must distinguish unintended
  metadata loss from confirmed venue corrections. In particular, the organiser
  confirms Beth Hart's 2026-11-21 Hannover move from Swiss Life Hall to Kuppelsaal
  (`https://www.hannover-concerts.de/wp-content/uploads/2025/09/Beth-Hart-Verlegungsmailing.pdf`).
  A new source-to-pipeline regression forbids restoring that former venue and
  its coordinates merely because its stale record has more fields. Six focused
  artist-location tests pass. GitHub verification of `acfce50` passed; this does
  not clear the documented integration blocker.
- Integration checkpoint, 2026-09-27: the reviewed companion snapshot is now
  included in PR #150's worktree rather than requiring a second PR. Its pipeline
  SHA-256 is `2b4556c97ccb909f34be64d1a7340632ac9d60499c7d742104d5c3051dd93b5b`.
  Cache reuse is bound to config/direct-module bytes; orphan 304 responses fail
  rather than claim success. Compatible same-venue/country duplicates can select
  a strictly richer whole record, preserving ticket-presence priority and all
  existing protected categories. No cross-source field splicing or speculative
  venue alias matching was added. Both extra source adapters now also use the
  shared safe ticket-URL helper, with an unsafe-scheme regression.
- Combined September 27 artifact replay (source replacements plus the companion
  location repairs aligned to today's exact raw rows) yields 38,846 published:
  50 added keys, 51 removed malformed keys, all removed performances still
  represented by artist/date. Country-length rejects fall 520 → 283; all schema
  rejects fall 546 → 309. Without the duplicate fix, these source repairs would
  lose metadata on 177 surviving keys; with it, 126 losses are prevented and 51
  conservative conflicts remain (49 differing venue labels, two incomparable
  same-venue records). These conflicts are explicit limitations, not zero-loss
  recovery. Independent review accepted this bounded policy and confirmed the
  Hannover relocation is preserved. Emancipator remains fixture/cache-only here.
- Combined checks: 585 tests passed, one skipped; build, lint (zero errors),
  production SSRF policy, selector ceiling (130/131), and diff checks passed.
  This clears the earlier code-integration blocker, not the hosted verification
  requirement. Next: commit the integrated snapshot, verify CI on its exact head,
  merge, then one artist → daily → Pages cycle with checkout/cache/public evidence.

- Hosted verification completed on 2026-09-27 (supersedes the pending step
  above): PR #150 merged as `97d6f191f3d764b64a247ebd3f18769f47049c3b`;
  artist run `36326264206` and automatic daily/Pages `36327597091` both
  checked out that SHA. Public generatedAt `2026-09-27T15:01:59.619Z`:
  39,109 concerts, artists 373/414 and venues 97/147 successful, 283 country
  length rejects / 309 schema rejects. Public concerts/index/status exactly
  matched the saved publication; all 94 country codes were retained.
  Eventbrite remained WAF-blocked; Emancipator remained a stale-cache `/tour/`
  404. The dashboard correctly remained DEGRADED. Evidence and complete
  verification are in `/tmp/concert-release-20260927.bFSeVr/`.

## Country-source continuation — 2026-09-28

- Alex requested continued recovery. Isolated worktree
  `/tmp/concert-country-sources-20260928`, branch
  `codex/country-sources-recovery-20260928`, base `8fc4b6b`. Shared checkout
  and the separate Hue & Cry worktree remain untouched. Root owns integration
  and the single next release/collection. No collection has been started.
- Fresh official HTML captures reproduce combined-location leakage for Steve
  Cardenas, Ocean Colour Scene, Kevin Puts and Andrea Motis. Source-specific
  adapters now separate venue/city/country without changing strict validators.
  Steve's explicit 2026 heading prevents archived shows becoming 2027 events;
  the workshop is excluded. Kevin's explicitly listed days are ISO dates,
  including cross-month lists. Continuous ranges and unpaired multiple venues
  remain incomplete rather than imply daily performances. Independent review
  caught and regression-locked the former false `2027-09-26` Kevin event.
- Full production-artifact baseline replay is exact: 67,166 raw → 39,109
  published. Controlled replacements under the existing duplicate policy yield
  67,181 raw → 39,150 published: **41 added keys, zero removed**, country-length
  rejects **283 → 206**, all schema rejects **309 → 232**. These are offline
  effects at the fixed publication date, not hosted recovery or a forecast of
  the next daily total. Evidence: `/tmp/concert-country-replay-source-final-20260928.json`.
- Three exact Ocean venue labels are verified against official artist, venue
  and ticket listings; city/country-scoped mappings preserve compatible whole
  records under the existing policy. No global venue aliases or field splicing.
  One existing Andrea Madrid record changes from the false venue `ANDREA MOTIS`
  to the organiser-confirmed Teatro Monumental. Its old time/coordinates are
  deliberately not transferred. Regression tests cover both boundaries.
- Source coverage is partial: Andrea parses 11 of 13 rows, excluding a missing
  Washington venue and an ambiguous Portalblau location; Kevin expands 20 cards
  to 29 records, with four incomplete. Steve has 52 explicit dated concerts,
  only five future at the fixed baseline; the other 47 are past, not recovered
  future shows. Ocean parses all 12 cards. Official Raimat sections disagree
  on 7/8 October; the artist's explicit 8 October remains unchanged. Music Glue
  detail-page times conflict with venue/ticket listings and are not imported.
- Source-only checks: **595 tests passed, one skipped**, TypeScript build,
  lint (zero errors, 106 existing warnings), production SSRF policy, selector
  audit (127, below ceiling 131), diff check and independent review passed.
- Subsequent accepted decision in the coordinated Hue & Cry task: a verified
  official artist source must win as a whole record regardless of input order
  or aggregator completeness. Missing unverified optional fields are reported,
  not automatically classified as data loss; fields remain unspliced. That
  task supplied pipeline/trust/cache changes and Hue & Cry in `1c80084`,
  integrated here as `53cf6c7`; root explicitly registered all five reviewed
  sources. Authority requires the current config/module fingerprint, verified
  cache timestamp and exact config URL/domain/artist, and follows object identity.
  A matching previously verified last-good cache retains authority after a fetch
  failure without refreshing its timestamps; that is not a fresh source read.
- Combined offline verification supersedes the source-only candidate figures:
  **39,109 → 39,153**, 44 added keys, zero removed, all 94 countries retained;
  country-length rejects **283 → 192**, all schema rejects **309 → 218**.
  All 66 valid official rows win as complete records in either input order:
  Hue & Cry 14, Steve 5, Ocean 12, Kevin 24 and Andrea 11 at the fixed baseline.
  Other artists are unchanged. After existing cache-only geocoding, 22 changed
  existing records omit some former optional fields, intentionally under the
  accepted official-source policy. No network geocoding or cross-source copying.
  The complete baseline multiset equals the released public artifact. Evidence:
  `/tmp/concert-combined-20260928/summary.json`; cache eligibility is simulated,
  so this does not establish hosted freshness or predict the next daily total.
- Integration regression checks real schema-loaded configs as well as adapters.
  It caught missing required Steve selector fallback fields; the original fields
  are restored, but the custom parser never uses the country fallback to guess
  unknown locations. **605 tests passed, one skipped**; build, lint (zero errors,
  106 existing warnings), production SSRF, selector ratchet and diff check pass.
  Root owns the combined PR and one artist → automatic daily → Pages cycle;
  exact checkout, fresh cache fingerprints and public-artifact proof are pending.

### 2026-09-28 — Showaddywaddy explicit-date candidate, local only

- Package `vacation-20260928-concert-showaddywaddy-date-13`, isolated branch
  `codex/showaddywaddy-date-20260928` from released PR #153 SHA
  `5b9b7586f2bd6ff51eebb671189516e904bc3612`. The preceding pending-publication
  note is historical: PR #153 was published and verified with artist run
  `36361029016`, Daily/Pages `36362537149`, and 38,914 public records. This new
  package stops at a local candidate; it does not change that hosted release.
- Obtained original `https://showaddywaddy.net/gigs/` HTML by ordinary HTTPS,
  HTTP 200 on 2026-09-28 at 01:51:28Z. SHA-256:
  `f8086ecaaef7180c4e16897b9e4ffdf66d7594c357cc609b12e60bae0f575599`.
  Port Talbot's `Sat 27h` belongs to **November 2027**, hence **2027-11-27**.
  The full response and headers are preserved, and the checked-in compact
  fixture produces exactly the same parser output as the original HTML.
- Changed only this source to `custom_js` and added its date parser/fixture/tests.
  Dates require an explicit month/year heading, a valid calendar date and a
  matching weekday. Invalid headings reset context; nested tables are isolated.
  The observed `27h` suffix is accepted without guessing a month/year or time.
  Of 115 event rows, 114 parse; `Thu 24th` under September 2027 (Sevenoaks) is
  rejected because September 24 is Friday. Missing/ambiguous date context fails.
- Old selectors on the fetched HTML reproduce all 115 saved cache rows exactly
  apart from observation timestamps. For all 114 accepted rows, every non-date
  field is unchanged. In particular, the old unsupported `a@href` ticket selector
  still yields no ticket URLs; no incidental link or location repair was included.
  URL/domain, official-source registry, global parsing/validation/deduplication,
  provider caps, schedules and other source configurations are unchanged.
- Complete offline replays use each saved release's original input order, artist
  DB, fixed clock and cache-only geocoding. Both baselines equal their complete
  public artifacts. September 27: **39,109 → 39,212**, 104 additions/one removal.
  September 28: **38,914 → 39,016**, 103 additions/one removal. Existing-key
  record changes: zero. All additions/removals are Showaddywaddy; every other
  artist's complete record multiset is identical, and country sets are unchanged.
  Port Talbot is 2027-11-27 in both. Source processing is 114 rows → 104/103 valid,
  with 10/11 past dates and zero schema/date failures. The single ambiguous row
  is rejected by the source parser before those 114 rows enter the pipeline.
- **Not publication-ready:** date recovery exposes inherited location problems.
  Five new official rows still use GB despite overseas locations (including an
  explicit Denmark row and Castlebar, whose retained Bandsintown record says IE).
  Eight Showaddywaddy dates have both official and provider records because the
  official city still includes the venue. These are records, not a claim of 103
  unique recovered concerts. Resolving locations/event identity is a separate
  source-specific follow-up; no country guesses or global dedupe changes here.
- Checks: **610 tests passed, one skipped**; five targeted tests passed; build,
  lint (zero errors/106 existing warnings), production SSRF test, selector ratchet
  (127 <= 131), diff check and bounded independent review passed. Final successful
  offline replays attempted zero network calls. Earlier harness failures (axios
  module-instance mock and non-unique post-geocode keys) are recorded separately;
  they were fixed in the evidence script, without changing product rules.
- Evidence: `/private/tmp/concert-showaddywaddy-20260928-evidence/` contains
  `source-manifest.json`, original HTML/headers, `replay-summary.json`, both full
  before/after catalogues, per-row deltas, source rejection inventory and logs.
  Source observation timestamps are held fixed in replay to isolate date changes;
  this is not a fresh hosted cache or publication claim. The new parser/config
  fingerprint differs from the old cache and requires a successful future refresh.
  No commit, push, PR, merge, full collection or deployment was performed. Other
  dirty worktrees were preserved. Stop condition: locally checked candidate and
  explicit remaining location/identity limitations, now reached.

### 2026-09-28 — Showaddywaddy verified locations and release candidate

- Alex subsequently requested publication and a real collection check. This
  supersedes the previous local-only stopping condition. The isolated branch
  was fast-forwarded to current main `ae4fbbe` before release checks; other
  worktrees remain untouched. Schedules, API caps and global processing rules
  are unchanged.
- The date parser now uses 13 exact location labels checked against official
  artist/venue pages. Ireland is confirmed for Drogheda, Letterkenny, Dublin
  and Castlebar; the Denmark venue is Hotel Fuglsøcentret in Knebel, not the
  misspelled street name in the artist table. Port Talbot retains the artist's
  Princess Royal Theatre alias (the operator now calls it Yr Aelwyd).
  Seven UK event identities are corroborated by their official venues.
- Unknown labels never inherit the configured GB fallback: 101 date-valid
  rows retain their source location but omit country and are rejected as
  incomplete by existing validation. The one explicit Castlebar performance
  on 2026-12-06 is held because the provider calls its county Mayo the city;
  inventing a matching city would be wrong and emitting Castlebar would add a
  known duplicate. Its existing provider record remains unchanged. Sevenoaks
  2027-09-24 remains rejected for the source's conflicting weekday.
- Full saved-HTML fixture output is identical to the original response:
  115 event rows produce 113 raw rows, 12 complete and 101 incomplete. The
  date/weekday/calendar boundaries, exact Castlebar hold and unknown-country
  behavior have regression tests. Existing ticket extraction is preserved;
  the configured unsupported `a@href` still provides no ticket URLs.
- Both full offline baselines reproduce their published artifacts exactly.
  September 27: **39,109 → 39,113**; September 28: **38,914 → 38,918**.
  Each has five added keys, one removed malformed Port Talbot key and five
  changed existing records. Showaddywaddy grows **10 → 14** with no remaining
  same-artist/date duplicate groups; all other artists' complete record
  multisets and each country set are unchanged (94 on September 27, 93 on
  September 28). The correct Port Talbot date
  is 2027-11-27. These controlled effects do not predict the next live total.
- Existing dedupe selects ten official rows and four provider rows. Five
  changed venue labels retain the whole official record, omitting former
  provider times/coordinates (and one venue kind); no optional fields are
  copied between sources. Two identical venue labels retain richer provider
  records. This source is not added to the verified-authority registry.
- Location evidence includes The TLT, Mount Errigal, The Helix, TF Royal,
  Fuglsøcentret, WX Wakefield, Playhouse Whitley Bay, Picturedrome, Visit Derby,
  Exeter Corn Exchange, Tivoli, Alhambra and the Port Talbot venue. Exact URLs,
  saved responses/extracts and country evidence are retained in
  `/private/tmp/concert-showaddywaddy-location-20260928/approved-locations.json`
  and its `foreign/`, `duplicates/`, Castlebar and Port Talbot proof files.
  Dunfermline's future event date conflicts with a taken-place banner, so its
  booking status remains unresolved; only identity/location is corroborated.
- Checks: **612 tests passed, one skipped**, seven targeted tests, build,
  lint (zero errors, 106 existing warnings), production SSRF policy and full
  two-clock offline replay passed. Every replay attempted zero network calls.
  Evidence: `/private/tmp/concert-showaddywaddy-location-20260928/`, including
  whole catalogues, per-row changes, explicit holds and processing diagnostics.
  Independent release review found no blockers. Next: release the exact checked
  snapshot, run one artist → automatic daily → Pages cycle and verify the
  public artifacts.

### 2026-09-28 — Showaddywaddy hosted verification completed

- PR #156 merged as `da3384bfa4fbe0072b71daf62ff4d4cd8788d579` after CI
  `36369857719` passed 612 tests (one skipped), build, lint and selector ratchet.
  The CI merge tree exactly equals the released tree. This completes the
  preceding release candidate's pending publication step.
- One artist dispatch `36370020899` and automatic Daily/Pages `36371332504`
  both actually checked out that release SHA. All six reviewed official pages
  were freshly extracted after merge with matching config/module fingerprints.
  The hosted Showaddywaddy cache exactly equals the tested fixture output:
  113 raw rows, 12 complete and 101 incomplete. Daily consumed the exact artist
  cache and run manifest from that producer. No schedule or cap was changed.
- Public generation `2026-09-28T02:57:33.367Z`, Pages completed at 02:58:46Z:
  **39,148 concerts across 93 countries**. Public root HTML and all three JSON
  files (concerts/index/status) exactly equal the saved publication artifact.
  Catalogue SHA-256: `0f23e229a6c149a81db00b98c5581d6ca18dfa02484502c20d982f091fed2806`.
- Offline replay of all **66,839 fresh raw rows** reproduces every complete
  published record. All **64 valid verified-authority records** from the five
  registered official sources survive as complete records. Replacing only
  Showaddywaddy with its previous cache yields 39,144 rather than 39,148; every
  other artist is identical on those same fresh inputs. Showaddywaddy has 14
  events instead of ten, no known same-date duplicates, correct IE/DK locations
  and Port Talbot on 2027-11-27. The Castlebar provider record is unchanged.
- Fleet health remains **DEGRADED**: artists 373/414 successful, venues 98/147.
  Eventbrite returned HTTP 405 on all five attempted requests and retained old
  cached data. Schema rejects remain 217, including 191 country-length rejects.
  The 101 unverified Showaddywaddy locations and exact Castlebar official row
  remain held; five official winners omit unconfirmed provider times/coordinates.
  These limitations are not hidden by the successful publication gate.
- Full evidence, logs, source freshness, public files and exact replay results:
  `/private/tmp/concert-release-showaddywaddy-20260928/`. Requested publication
  and hosted verification are complete. Next bounded improvement: verify more
  source locations; the global validators, dedupe policy and intervals stay as-is.

### 2026-09-28 — Showaddywaddy eight-venue continuation, local only

- Package `vacation-20260928-concert-showaddywaddy-venues-15` adds only eight
  exact, officially verified location labels: Carlisle/The Sands Centre,
  Rhyl/Pavilion Theatre, Runcorn/The Brindley, Stockport/The Plaza,
  Leamington Spa/Royal Spa Centre, Folkestone/Leas Cliff Hall,
  Paisley/Paisley Town Hall and Melton Mowbray/Melton Theatre. All are GB by
  official venue/civic address evidence, not the configured country fallback.
  URLs, access dates, excerpts and caveats are preserved in
  `tests/fixtures/artist-showaddywaddy-locations-20260928.json` and the evidence
  directory's `proof-a/manifest.json`, `proof-b/manifest.json`.
- Eight places recover nine dated rows because Runcorn appears on 2026-10-16
  and 2027-11-05. Dates still come from the official artist calendar. Runcorn's
  exact dates and Melton's date lack independent venue-event confirmation;
  other venue-page limitations are documented per row. This does not claim
  ticket availability or verified show times. Castlebar's hold is unchanged.
- The fixture/full saved HTML yields the same 113 raw rows: complete locations
  **12 → 21**, incomplete **101 → 92**. No dates or non-location source fields
  change. Unknown and merely similar labels remain incomplete; Sevenoaks's
  weekday conflict and the exact Castlebar exclusion still apply.
- Latest artifact replay uses all **66,839 saved raw rows**, original ordering,
  saved artist DB, existing cache-only geocoding and the actual publication
  clock. Baseline equals the full released public artifact. Candidate:
  **39,148 → 39,157**, Showaddywaddy **14 → 23**, nine additions, zero removals
  and zero existing-record changes. All other artists' complete records and all
  93 countries are identical; there are no same-artist/date duplicate groups.
  Incomplete rejects fall 1,835 → 1,826; all other rejection counts are unchanged.
- The same latest inputs also pass both earlier saved-clock regressions:
  September 27 clock 39,572 → 39,581; September 28 clock 39,148 → 39,157.
  These are controlled clock simulations, not historical-publication claims.
  Existing optional fields never change. New Paisley coordinates come from the
  existing exact geocode-cache key; no coordinates are added elsewhere and no
  start times are inferred. Existing website ticket fallback and venueKind
  derivation remain unchanged; there is no cross-source field copying.
- Checks: all eight focused parser tests (including both clocks), TypeScript
  build, focused ESLint and diff check pass. Three complete baseline/candidate
  replays and independent delta validation pass with zero network attempts.
  The full test suite was not rerun for this mapping-only local candidate.
  Evidence: `/private/tmp/concert-showaddywaddy-venues-20260928/` contains
  source proofs, all before/after catalogues, complete Showaddywaddy deltas,
  optional-field/rejection checks and input hashes. Earlier dirty BACKLOG work
  is preserved. No collection, commit, push, PR, merge or publication was done;
  global validators/dedupe, registry, schedules and caps are untouched. Stop:
  locally verified candidate; any hosted verification remains a later step.

### 2026-09-28 — Eight-venue candidate approved for publication

- Alex explicitly requested publication and a real run check, superseding the
  preceding local-only stopping condition. The release branch
  `codex/showaddywaddy-venues-20260928` is based on current main `a11532d`;
  existing hosted-verification notes and other worktrees are preserved.
- Full release checks pass: **613 tests, one skipped**, build, lint with zero
  errors (106 existing warnings), production SSRF policy and selector ratchet
  (127 offenders, baseline 131). The exact source/fixture diff was independently
  reviewed; no blockers were found. This supersedes the previous full-suite
  not-run limitation. No runtime, schedule, API cap or global validation changed.
- Fresh offline replay of all 66,839 saved rows passes at all three saved clocks:
  nine additions, zero removals/changed records, other artists and country sets
  unchanged. The actual-publication-clock control is 39,148 → 39,157 and
  Showaddywaddy 14 → 23. The earlier clocks remain counterfactual simulations.
  Runcorn/Melton date caveats and all existing holds remain as documented above.
- Full logs, input hashes, dirty snapshot, independent review and replay results:
  `/private/tmp/concert-showaddywaddy-venues-gate-20260928/`. Next: merge only
  after exact-candidate CI, run artist → automatic Daily/Pages, and check actual
  source freshness and public-artifact equality. Hosted verification is pending.

### 2026-09-28 — Eight-venue release and hosted verification completed

- PR #159 merged as `00ad551019aaea043ac09ab093a955b694d9eb4c`. CI
  `36374432520` passed 613 tests (one skipped), build, lint and selector ratchet;
  the tested merge tree equals the released tree. Artist `36374621592` and
  automatic Daily/Pages `36375902099` both actually checked out that release.
  One artist dispatch, no manual Daily dispatch; intervals and caps unchanged.
- The official Showaddywaddy page was freshly extracted at
  `2026-09-28T03:42:24.685Z`, verified at 03:43:02.790Z with the matching new
  parser fingerprint. Hosted output exactly matches the tested fixture after
  JSON serialization: 113 raw rows, 21 complete and 92 held as incomplete.
  Daily consumed the exact artist/Bandsintown/Eventbrite caches and artist
  manifest from this producer. Castlebar and Sevenoaks holds are unchanged.
- Pages completed at **04:09:10Z**; public generation **04:05:51.260Z** contains
  **39,409 concerts across 94 countries**, including **23 Showaddywaddy**
  concerts versus the previous 14. Root HTML plus concerts/index/status JSON
  are byte-identical to the saved publication artifact. Catalogue SHA-256:
  `7f2820c9c540b3752ad162fb04db1f70c66788e05a975f5e779dc71f7ca2dc8f`.
- Complete offline replay of all **66,712 actual raw inputs** reproduces every
  published record; all 64 valid whole records from the five registered official
  sources survive. Holding inputs, artist DB, geocode cache, processing clock
  and source observation time fixed, the previous mapping yields **39,400**:
  this change contributes **nine additions**, zero removals or existing-record
  changes, with identical other-artist records/country sets and no Showaddywaddy
  same-date duplicates. The total live increase from 39,148 also contains other
  source changes and must not all be attributed to this patch.
- The initial comparison control retained the old source observation timestamp:
  ten existing official rows therefore differed only in `scrapedAt`. The harness
  now fixes that timestamp on both sides, explicitly checks unchanged non-location
  raw fields and retains complete-record assertions. No production fix was needed;
  the initial log and the ten timestamp-only differences remain in the evidence.
- Fleet health remains **DEGRADED**: artists 374/414 successful, venues 93/147,
  three stale venue caches; all five Eventbrite requests returned HTTP 405 and
  reused its prior data. Schema rejects: 217, including 191 country-length
  rejects. The 92 unverified Showaddywaddy locations remain held. Runcorn/Melton
  dates retain the documented artist-calendar-only confirmation caveat.
- Full release, source-freshness, public-equality and replay evidence:
  `/private/tmp/concert-release-showaddywaddy-venues-20260928/`. Publication and
  requested real-run verification are complete; no further source expansion was
  performed. Other worktrees are preserved. Future work remains bounded source
  recovery using official evidence, without relaxing validation or cadence.

### 2026-09-28 — The Iron Maidens source recovery, local candidate

- Package `vacation-20260928-concert-ironmaidens-source-17` is restricted to one
  failing source, `scrapers/artist-iron-maidens-the.json`, on isolated branch
  `codex/iron-maidens-recovery-20260928` at base `a654cbe`. The preceding release's
  local verification journal was copied forward without modifying its worktree.
  No general collection, commit, PR, merge or publication is part of this package.
- Latest saved hosted evidence has `selectors_stale`: obsolete `.tour-item`
  selectors return nothing. The fallback cache contains 11 incomplete rows with
  venue names as artists, empty cities, a blind US country and malformed JSON-LD
  date/time strings; none of this source's rows is present in the public catalogue.
- Real official HTML from `https://theironmaidens.com/upcoming-events/` was saved
  on `2026-09-28T04:39:57.460Z` through the configured `got-scraping` fetch path
  and existing SSRF guards. A preceding ordinary urllib request returned 403;
  no authentication/challenge bypass was used. The complete response is preserved
  as the fixture (113,095 bytes, SHA-256
  `e49582462e8931d30b7a9140068a385916402ea8bce6f2b4c780974d5b17131f`).
- The custom parser uses explicit EventON card year/month/day with strict calendar
  checks and the fixed artist name. Ten exact venue/full-address pairs establish
  their cities and US states; no country or city is guessed for unknown/moved
  addresses. `countryNameFallback: US` remains only because the existing custom
  runner requires selectors and their legacy schema requires that field; the
  custom parser deliberately never reads it. Global schema/runner are unchanged.
- Jericho Cruise is held: the November 7–11 itinerary spans Miami, FL and Bimini,
  Bahamas and has no defensible single performance date/city/country. Cancelled,
  postponed, incomplete, conflicting date blocks and multi-day cards are held.
  All-day records have no invented time; the five timed rows retain literal local
  display times. Wildcatter explicitly says 07:00, not 19:00; the malformed JSON-LD
  timezone offsets are not used, and show time/availability is not independently
  confirmed with the venue.
- Ten direct ticket URLs are retained in raw output only on seven exact observed
  HTTPS hosts. Credentials, nondefault ports, unsafe schemes, private/unknown and
  suffix-spoof hosts are rejected. All seven hosts resolved to public addresses
  under the production SSRF predicate at verification time. This does not claim
  ticket availability or safe redirect destinations. Existing global processing
  still prefers the approved artist website for public `ticketUrl`; that behavior
  was not changed, so direct ticket preservation is a source-cache result.
- Complete offline replay starts from all **66,712 latest saved raw inputs** and
  reproduces every public baseline record at its actual saved clock. Replacing
  only this source's 11 incomplete rows with ten proven rows yields **66,711 raw**
  and **39,409 → 39,419 published**. Every existing complete record is unchanged;
  all ten additions are The Iron Maidens, without same-date duplicates or changes
  to any other artist. All 94 countries remain. Incomplete rejections fall
  1,826 → 1,815; every other rejection count is unchanged. No coordinates were
  inferred and the replay made zero network requests. Every addition is linked
  to its exact source row/date/address/ticket evidence in `changes.json`.
- Checks on the final parser: six focused tests (including configured runner
  dispatch), build, focused ESLint and diff check pass. Production SSRF policy
  passes; selector ratchet remains 127 against baseline 131. Full offline replay
  passes. The full project test suite and a new hosted run were not performed for
  this local candidate. Evidence, proofs, hashes and whole replay catalogues:
  `/private/tmp/concert-iron-maidens-20260928-evidence/`. Independent read-only
  review found no blockers and independently confirmed the complete-record delta.
  Stop condition reached: reviewable local candidate; publication remains outside
  this package's scope.

### 2026-09-28 — The Iron Maidens prepublication gate, local PASS

- Package `vacation-20260928-concert-ironmaidens-gate-18` completes the previously
  deferred full local checks for source-17. Branch remains
  `codex/iron-maidens-recovery-20260928`, HEAD
  `a654cbe5000f0986a56f8b7f712b9d66ee0f71d6`. The six original dirty files matched
  the source-17 hashes exactly before checks. No source/config/test/fixture change
  was needed; only this journal entry was added after verification.
- `npm test`: **619 passed, zero failed, one intentional skip**. The skipped
  production SSRF predicate was separately run with the localhost escape hatch
  unset: **1/1 passed**. The full suite included the six source fixture/edge tests
  and actual headless Chromium rendering against a local mock HTTP server.
  `npm run build` passed. Full `npm run lint` returned zero errors and 106 warnings
  outside this candidate's source/test files. Local runtime: Node v25.4.0 and
  npm 11.7.0; hosted CI uses Node 22 and was not run for this local gate.
- Selector ratchet passed at **127 <= 131**, with this source absent from the
  offenders. Diff check passed. Independent read-only review rechecked actual
  hashes, official HTML/proof/config alignment, the ten date/address/location
  mappings, cruise/multi-day/cancelled/postponed/unknown guards, all-day omission
  of time, literal Wildcatter 07:00 and exact HTTPS ticket-host restrictions.
- The full offline processing replay was rerun on the same saved release inputs
  and clock. Baseline equals all 39,409 public records; candidate has **39,419**:
  exactly ten attributed The Iron Maidens additions, zero removals and zero
  changes to existing complete records. Other artists and all 94 countries are
  unchanged, with no target same-date duplicates or Iron Maiden collision.
  Source raw rows change 11 incomplete to ten valid; global incomplete rejects
  fall 1,826 to 1,815; all other rejection counts remain identical. Network
  attempts during replay: zero. Every addition retains exact official/raw/final
  attribution in the gate artifact's `replay/changes.json`.
- Gate result is **PASS, reviewable local candidate only**. This supersedes the
  source-17 full-suite not-run state, not its publication boundary. No new general
  collection, commit, PR, merge, hosted run or publication was performed. Existing
  caveats remain: ambiguous cruise and unknown locations are held; show times are
  literal source claims; raw ticket URLs survive extraction, while the unchanged
  public processor prefers the artist website. Ticket availability and redirects
  remain unverified. Other worktrees were not changed.
- Logs, commands, exit codes, initial/final file hashes, independent review and
  replay outputs: `/private/tmp/concert-iron-maidens-20260928-gate18/gate.json`.
  Stop here for Alex's decision on this local candidate.

### 2026-09-28 — Belgrade Philharmonic 2026/27 season recovery, local candidate

- Package `vacation-20260928-concert-belgrade-season-19` works independently of
  the uncommitted Iron Maidens candidate. Clean worktree was created from freshly
  fetched main at `a2a47fbbb7a2905c99105ea87ee77c23f65c7b27`, branch
  `codex/belgrade-season-recovery-20260928`. The canonical prior journal was
  carried forward without copying Iron Maidens code or altering that worktree.
- Latest published Daily run is still `36375902099`, release `00ad551`, with
  39,409 concerts. Current main's changes since that release affect artist data
  and repair history, not runtime or scraper configs. The saved run manifest
  reports `selectors_stale` for `artist-belgrade-philharmonic-orchestra`; its old
  `/en/concerts/` configuration has no saved venue cache or public orchestra rows.
- Ordinary guarded HTTP access captured the official English 2026/27 season on
  `2026-09-28T05:30:58.244Z`: 213,231 bytes, SHA-256
  `49ee9ec575687c90655d23aa1cbc855d7f5608aae8efb9ce3fd879e9d5ba7ce9`.
  The complete HTML is preserved as `tests/fixtures/artist-belgrade-season-20260928.html`.
  Twenty-five cards explicitly give full dates, 20:00, and Grand Hall of the
  Kolarac Foundation, from 9 October 2026 through 11 June 2027. The venue's own
  foundation page confirms its Belgrade address, Studentski trg 5; each accepted
  exact venue label maps to Belgrade/RS, without a blanket Kolarac fallback.
- A source-specific custom parser replaces obsolete selectors and pins the
  observed season URL, canonical URL and season body marker. Artist identity is
  always Belgrade Philharmonic Orchestra, never the programme's conductor or
  soloist. Full explicit calendar dates and valid times are required; missing,
  ambiguous, unknown-venue, cancelled/postponed and prior-local-date cards are
  held. Observation date uses Europe/Belgrade. Identical cards collapse; differing
  programme URLs/titles/times on one date are held rather than silently merged.
- Season cards link to programme pages and contain no direct ticket URLs. The
  parser deliberately emits no raw `ticketUrl`; it does not assign navigation,
  conductor or programme links as tickets. A separately captured first programme
  confirms a distinct event ticket URL, but this bounded parser adds no detail
  fetches or hard-coded ticket mapping. The unchanged global processor still
  supplies the approved artist website publicly. Direct ticket extraction and
  automatic discovery of a later season remain outside this candidate.
- Five focused tests passed, including the configured runner with frozen clock
  and mocked HTTP, actual fixture, wrong-page/date/time/location/status cases and
  duplicate conflicts. Build and focused ESLint passed. Initial test failure
  exposed an actual cancellation-text boundary defect in compact markup; the
  filter now covers text and card/container classes. Its failed log is retained
  separately, and the final tests/build/lint were rerun after the fix. Production
  SSRF test passed 1/1; selector ratchet passed 127 <= 131. No global validation,
  schedules, request caps, provider logic or dependencies were changed.
- Full offline replay uses all **66,712 saved raw records**, the saved approved
  artist DB, geocode caches and the exact published clock. Baseline reproduces
  every public record. Adding only the 25 new source rows gives **66,737 raw** and
  **39,409 -> 39,434 published**: exactly 25 attributed orchestra additions,
  zero removals and zero changes to existing complete records. Other artists,
  all 94 countries and every processing rejection count remain unchanged. Target
  same-date duplicates: zero; replay network requests: zero. Per-card evidence
  links date/time/venue/country/programme URL to raw and final rows in `changes.json`.
- Evidence and check logs: `/private/tmp/concert-belgrade-season-20260928-evidence/`.
  Full project suite and a hosted candidate run were not performed for this
  local source package. Independent read-only review found no blockers: all 25
  official cards match the proof, and a separate complete-record multiset check
  confirmed the exact catalogue delta. Final manifest, file hashes and limitations:
  `verification.json` in that evidence directory. Stop condition reached at a
  reviewable local candidate; no general collection, commit, PR, merge or
  publication was performed. The protected Iron Maidens file hashes remain equal
  to its completed gate-18 snapshot.

### 2026-09-28 — Belgrade Philharmonic prepublication gate, local PASS

- Package `vacation-20260928-concert-belgrade-gate-20` closes the full local-suite
  gap left by source-19. Branch `codex/belgrade-season-recovery-20260928`, HEAD
  `a2a47fbbb7a2905c99105ea87ee77c23f65c7b27`. All six dirty files matched the
  source-19 manifest before checks; source, config, tests and fixtures remain
  byte-identical. Only this journal entry changes in gate-20.
- `npm test`: **618 passed, zero failed, one intentional skip**. The skipped
  production SSRF predicate separately passed **1/1** without the localhost
  escape hatch. The full suite includes the five Belgrade fixture/edge tests,
  frozen-clock runner dispatch and real headless Chromium against local mocks.
  `npm run build` passed; full `npm run lint` passed with zero errors and 106
  warnings outside this candidate's source/test files. Selector ratchet remains
  **127 <= 131**, this source is not an offender. Diff check passed.
- Full saved-raw replay was repeated from all **66,712** original inputs at the
  published clock with the same saved approved artist DB and geocode caches.
  Baseline exactly reproduces 39,409 public records. Candidate has **66,737 raw**
  and **39,434 published**: 25 orchestra additions, zero removals, zero changes to
  existing complete records; all other artists, 94 countries and rejection counts
  remain identical. Target same-date duplicates and replay network attempts: zero.
  The 25 additions are attributed individually to official cards and proof, raw
  records and final records in the new gate's `replay/changes.json`.
- The source19 evidence still applies to the unchanged parser: explicit full
  date/time, fixed orchestra identity, exact verified Kolarac label, prior-local-
  date/cancelled/unknown/incomplete/conflicting-card holds. No programme, conductor
  or navigation URL becomes a raw ticket link; public ticketUrl remains the
  approved artist website under unchanged global processing. The source remains
  deliberately pinned to season 2026/27; future season discovery is not included.
- This supersedes source19's full-suite not-run status. Local environment was
  Node v25.4.0/npm 11.7.0; hosted Node 22 CI was not run. No general collection,
  commit, PR, merge or publication was performed. Iron Maidens candidate remains
  protected and unchanged. Stop at a reviewable local candidate for Alex.
- Initial/final snapshot hashes, actual commands/exit codes/logs, replay and
  independent verification are recorded in
  `/private/tmp/concert-belgrade-season-20260928-gate20/gate.json`.

### 2026-09-28 — The Cure official-source diagnosis, HOLD without code changes

- Package `vacation-20260928-concert-cure-source-21` inspects only
  `artist-the-cure` from published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c` (Daily run `36375902099`).
  Isolated branch `codex/cure-source-diagnosis-20260928`; this journal retains
  the preceding local source/gate history. Iron Maidens and Belgrade candidates
  remain separate, dirty and protected; no candidate has been integrated here.
- Ordinary guarded HTTP read of `https://www.thecure.com/shows/` succeeded at
  `2026-09-28T06:26:05.802Z`, returning 68,776 bytes with SHA-256
  `1cafa8ae0b353d925d17c5472810c149341c2d2c32dceba105bc7a1e28cd9e54`.
  The official Shows page explicitly says **"No shows currently announced!"**
  inside `#shows_large`. It contains zero configured MusicEvent blocks, zero
  MusicEvent microdata nodes and no event JSON-LD. Diagnostic transport was the
  existing guarded got-scraping helper; production configuration is unchanged.
- Two resources directly linked by that page were read normally: first-party
  theme `default.js?v=6` contains layout/navigation/news code and no show feed;
  WordPress page metadata `/wp-json/wp/v2/pages/402` has empty rendered content
  and supplies no future event records. There was no access barrier, browser
  workaround, authentication or bypass. No unlinked endpoint or other artist
  source was explored.
- The saved published manifest marks this source `selectors_stale` with
  `Parsed 0 concerts`. That alone does not establish broken selectors when the
  current page explicitly announces no shows. Its saved cache has one The Cure
  concert dated 30 August 2026, Rock En Seine, Paris/France. At the published
  processing clock `2026-09-28T04:05:33.582Z`, diagnostics show raw 1, published 0,
  past-date drops 1; direct inspection of all 39,409 public rows finds zero exact
  `The Cure` records. The historical row is not an upcoming event to recover.
- **HOLD:** no explicit future date/venue/country records are available in the
  inspected official evidence, so there is no supported parser/config candidate.
  No runtime, config, fixture or test file changed. Build, suite, SSRF test,
  selector ratchet and offline candidate replay are N/A for this documentation-only
  diagnosis and were not run. Diff check and protected-file hash checks passed.
- Captured source bodies, URLs/timestamps/hashes, baseline diagnostics and
  preservation checks are recorded in
  `/private/tmp/concert-cure-source-20260928-evidence/source-diagnosis.json`.
  No commit, PR, merge, publication, hosted run, general collection or schedule/
  limit change was performed. Revisit this source when its official page contains
  explicit upcoming shows; current emptiness must not be filled with inferred dates.

### 2026-09-28 — Jane McDonald configured-source diagnosis, HOLD: parked domain

- Package `vacation-20260928-concert-jane-source-22` starts from published release
  SHA `00ad551019aaea043ac09ab093a955b694d9eb4c` in isolated branch
  `codex/jane-source-recovery-20260928`. Prior journal entries are preserved.
  Iron Maidens and Belgrade local candidates remain separate and unchanged.
- The approved artist DB names Jane McDonald and records website
  `https://www.janemcdonald.com/` and tour URL
  `https://www.janemcdonald.com/tour-dates`; this establishes the configured target,
  not present ownership or authenticity of content now served by that domain.
- A normal guarded got-scraping request to the configured tour URL at
  `2026-09-28T06:42:37.448Z` returned only a 114-byte HTML script pointing to
  `/lander`, SHA-256
  `6dc9c7fc93bb488bb0520a6c780a8d3c0fb5486a4711aca49b4c53fac7393023`.
  The existing production-default axios backend returned identical bytes at
  `2026-09-28T06:43:36.690Z`. Neither response has an artist name, tour content,
  configured event blocks, MusicEvent microdata or event JSON-LD.
- Only the explicitly referenced same-host `/lander` was followed, by another
  ordinary guarded HTTP read without executing JavaScript. Its 252,640-byte body,
  captured `2026-09-28T06:43:19.677Z`, SHA-256
  `86ca52db555d61208638e9f9d3e776c0be870c2696c7e3b69ba06678a063143c`,
  visibly advertises `janemcdonald.com` for sale via GoDaddy. Its JSON-LD is a
  domain-sale Product/Offer, not an event. No sales form or third-party link was
  submitted or followed; no authentication, access-control bypass or browser
  workaround was used. The configured domain currently fails artist identity.
- The saved published manifest reports `selectors_stale` for
  `scrapers/artist-jane-mcdonald.json`. It has no venue-cache entry, no processing
  diagnostics entry for `www.janemcdonald.com`, and none of the 39,409 published
  concerts has exact artist `Jane McDonald`. Zero parsed rows alone therefore
  does not establish a fixable selector change.
- **HOLD: configured source unavailable as an artist source, not verified empty
  tour.** No explicit future dates and reliable venue/city/country records are
  available in the inspected responses. No parser/config/test/fixture change was
  made; the existing UK fallback was not used to invent a country or any event.
  Build, focused tests, production SSRF test, selector ratchet and candidate replay
  were not run (N/A: no runtime candidate). Diff and protected-file hash checks
  passed. This diagnosis does not claim that Jane McDonald has no future concerts.
- Captured bodies, URLs/timestamps/hashes, configured identity, baseline facts,
  unchanged file checks and limits are recorded in
  `/private/tmp/concert-jane-source-20260928-evidence/source-diagnosis.json`.
  No commit/push/PR, hosted run, publication, general collection, global processing,
  artist DB, schedules or limits were changed. Next independent step, if authorized,
  is verified rediscovery of the artist's current official website from trusted
  artist-controlled references; it is not a selector repair on this parked domain.

### 2026-09-28 — Jane McDonald official website rediscovery, local links-only PASS

- Package `vacation-20260928-concert-jane-official-23` uses a new isolated branch
  `codex/jane-official-source-20260928` at published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. It follows source22's proven parked-
  domain HOLD; no earlier package is rerun or integrated. Prior journal history,
  Iron Maidens and Belgrade candidates are preserved.
- The proposed hyphenated domain is now independently verified. Website creator
  vtwo's own 2025 case study, `https://vtwo.co.uk/work/jane-mcdonald-rebrand`,
  explicitly describes the artist commissioning her website and collaboration
  with Jane and her team on the 2026 album/tour, and links its live site directly
  to `https://jane-mcdonald.com`. Ordinary guarded HTTP captured the full primary
  page at `2026-09-28T07:04:58.821Z`: 292,131 bytes, SHA-256
  `47bacc87f4109e60190c895d638304a933f5e1d70ad286d8253e68917aa1a749`.
  Channel 5's primary help article independently names the same website; its
  displayed update is 14 October 2025 10:14. The web tool read that article, but
  direct guarded access returned 403, so no fresh Channel 5 HTML capture is claimed.
  X/MCD search excerpts are recorded as leads only, not decisive identity proof.
- Exactly four source/data values change: Jane McDonald's `website` becomes
  `https://jane-mcdonald.com/`, `tourUrl` becomes `https://jane-mcdonald.com/tour`,
  and the existing source config receives that URL and `jane-mcdonald.com` domain.
  No artist metadata timestamps are falsely refreshed. Every other artist and all
  other config values, including existing selectors, are unchanged. No global
  parsing, registry, provider, schedule, cap or dependency changes are included.
- Guarded reads captured the home page, `/tour`, and its linked 17 November 2025
  album/tour news article. The production-default axios backend also received the
  tour page successfully. Current static tour HTML has generic August/September
  2026 text and a Songkick widget, without explicit future dated venue/city/country
  records. Embedded third-party widget data was not fetched or rendered. The home
  page's cruise interval, 2–9 October 2026, is not a dated performance and adds no
  concert. This does not establish that the artist has no future appearances.
- Focused existing tests passed **17/17**; the production SSRF test separately
  passed **1/1**. Four extra offline runner checks using saved tour/home/news HTML
  and the actual candidate config all produce zero events and `selectors_stale`;
  no false empty-success flag is introduced. LLM fallback was disabled only in
  that verification process, with zero network attempts/calls; production LLM
  settings are unchanged. The source is **not reported as collection recovered**.
- Build and full lint passed (zero errors, 106 existing warnings). Artist integrity
  passed at **141 existing errors**, equal to its baseline. The npm audit wrapper
  first failed on a sandbox-denied tsx IPC pipe; the same audit entrypoint and
  `--strict` gate passed via `node --import tsx`, without any source/tool change or
  baseline weakening. Selector ratchet passed **127 <= 131**; Jane is not an
  offender. Config schema, exact field diffs and diff whitespace checks passed.
- Full offline replay reconstructed **66,712 raw records** from the same saved
  release caches, approved artist DB and geocode caches at
  `2026-09-28T04:05:33.582Z`. Baseline exactly reproduces all public records. The
  candidate also has **39,409 concerts**, zero additions, removals or changed
  complete records, unchanged 94 countries, all source diagnostics and rejection
  counts, and zero network attempts. No new event rows were introduced.
- Two locally generated artist catalogues, each with 62,973 entries, differ only
  in Jane McDonald's website. This is an exact generated-before/after comparison,
  not a claim of live/public artists.json verification; that public file was not
  present in the saved baseline. Raw artist DB differs only in Jane's two URLs.
- Primary identity proof, source-body URLs/times/hashes, exact four-field diff,
  checks and replay are in
  `/private/tmp/concert-jane-official-20260928-evidence/verification.json`.
  Local runtime: Node v25.4.0/npm 11.7.0. Full suite belongs to a separate gate;
  hosted Node 22 CI, commit/push/PR, general collection and publication were not
  run. Stop at this verified local website/source-link candidate. Concrete event
  extraction remains HOLD until explicit performance records can be validated.

### 2026-09-28 — Jane McDonald links-only prepublication gate, local PASS

- Package `vacation-20260928-concert-jane-links-gate-24` checks source23 in the
  same isolated `codex/jane-official-source-20260928` worktree at HEAD
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Before any checks all three dirty
  file hashes matched source23 exactly. The two candidate data/config files stay
  byte-identical throughout gate24; only this journal entry changes. Protected
  Iron Maidens and Belgrade dirty files, branches and heads remain unchanged.
- Full `npm test`: **613 passed, zero failed, one intentional skip**, including
  actual headless Chromium against local mock pages. The production SSRF predicate
  skipped under the suite's localhost setup separately passed **1/1** with that
  escape hatch removed. Build passed. Full lint passed with zero errors and 106
  existing warnings. Strict artist integrity passed at 141 existing errors, equal
  to the unchanged baseline. It used the same audit entrypoint via
  `node --import tsx` to avoid the known tsx CLI IPC sandbox restriction.
  Selector ratchet passed **127 <= 131**; Jane is not an offender. Diff check passed.
- Repeated offline replay uses all **66,712** saved release raw records, approved
  artist DB, geocode caches and the exact published clock
  `2026-09-28T04:05:33.582Z`. Baseline and candidate each match every one of the
  **39,409** complete public records: zero additions, removals or modifications.
  All 94 countries, rejection counts and per-source diagnostics remain equal;
  only diagnostic generation timestamps differ. No new Jane concert is introduced.
  fetch, axios, HTTP/HTTPS and socket/TLS request guards observed zero network
  attempts. The two generated 62,973-entry artist catalogues differ only in
  Jane's website. No public artists.json equality claim is made from this local
  generated-catalogue comparison.
- Independent read-only review checked the captured primary vtwo case study and
  exact outbound domain, the four URL/domain field changes, all 11,521 shard-2
  entries and complete replay/catalogue multisets. No blocking finding for this
  links-only scope. vtwo's direct captured HTML is decisive identity evidence;
  Channel 5 web extraction remains corroboration only, with its direct403 preserved.
  No date, venue, country, ticket link or event was inferred from the cruise or
  generic tour text. Original schedules, caps and global processing are untouched.
- This closes source23's full-suite gap without changing its scope. The current
  static runner still yields no deterministic concerts from the inspected tour
  HTML, so **source collection remains HOLD**, not repaired or verified empty.
  Third-party Songkick widget data and production LLM extraction were not exercised.
- Evidence: `/private/tmp/concert-jane-links-20260928-gate24/gate.json`, including
  initial/final hashes, command logs, independent review and repeated replay.
  Local Node v25.4.0/npm 11.7.0; hosted Node22 CI was not run. No commit, push, PR,
  merge, hosted run, publication or general collection occurred. Stop at this
  reviewable local website/source-link candidate.

### 2026-09-28 — Jorge e Mateus official agenda diagnosis, HOLD: dynamic data unavailable

- Package `vacation-20260928-concert-jorge-source-25` starts in a new isolated
  `codex/jorge-source-recovery-20260928` worktree from published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Prior journal history is preserved;
  no runtime changes from the separate Iron Maidens, Belgrade or Jane candidates
  are integrated. Their dirty files, statuses and heads remain unchanged.
- Ordinary guarded HTTP using production-default axios read the configured
  `https://jorgeemateus.com.br/agenda/` successfully at
  `2026-09-28T07:37:12.380Z`: 42,480 bytes, SHA-256
  `e13b8a9655687b00a8e5ef15078ee8a5e8910e34f95cfdfd7b0f241f4fc873c8`.
  Its title and organization JSON-LD identify Jorge & Mateus; canonical URL is
  `https://www.jorgeemateus.com.br/agenda/`. JSON-LD contains page/organization
  metadata, not concerts. Its 2019 page metadata and the 2026 footer are not
  evidence of a performance date or year.
- The actual agenda list is a Vue template with `v-for="data in eventos"` and
  unresolved `agenda_data`, `title` and `agenda_local` expressions. There are zero
  configured `li.agenda-event` blocks and zero MusicEvent/Event microdata records.
  Merely changing the selector to `li.data-evento` would extract template strings,
  not a verified date, venue, city or country.
- A single ordinary guarded request to the exact first-party agenda script linked
  by this HTML, `https://www.jorgeemateus.com.br/wp-content/themes/jorgeemateus/customjs/page-agenda.js?ver=2.25.0`,
  returned HTTP 403 at `2026-09-28T07:37:45.117Z`. No script body or linked event feed
  could be inspected through that request. No access workaround, authentication,
  JavaScript execution, guessed API endpoint or third-party source was used.
- **HOLD:** the inspected source does not provide usable explicit future
  date/venue/city/country records. This is unavailable dynamic schedule evidence,
  not a verified empty tour or proof that the artist has no future performances.
  No event, ticket URL or BR country value is inferred from template placeholders,
  footer, contact address or configured fallback. No parser/config/test/fixture
  changes were made. Build, focused tests, SSRF test, selector ratchet and candidate
  replay are N/A and not run because there is no runtime candidate.
- Source URLs/timestamps/hashes, saved baseline facts and protected-file checks are
  preserved in `/private/tmp/concert-jorge-source-20260928-evidence/source-diagnosis.json`.
  Diff check passed. No commit/push/PR, hosted run, publication, general collection,
  artist DB, global processing, other source, schedule or limit change occurred.
  Revisit only when the official dynamic schedule is ordinarily readable and
  explicit performance/location evidence is available; do not fabricate a repair
  from the stale-selector label alone.
- Saved release baseline independently checked: manifest reports `selectors_stale`
  for `scrapers/artist-jorge-e-mateus.json`; source cache is absent and processing
  diagnostics contain neither bare nor www source host. None of the 39,409 public
  records has exact artist `Jorge e Mateus` or `Jorge & Mateus`. The approved artist
  spelling is `Jorge e Mateus`, with the same configured website and agenda URL.

### 2026-09-28 — Harry Connick Jr official tour diagnosis, HOLD: explicitly empty tour

- Package `vacation-20260928-concert-harry-source-26` uses a new isolated branch
  `codex/harry-source-recovery-20260928` at published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Prior canonical journal history is
  preserved; Iron Maidens, Belgrade, Jane and previous HOLD worktrees stay intact.
  No pending candidate is integrated or published by this independent diagnosis.
- The configured `https://www.harryconnickjr.com/tour/` was read normally through
  guarded production-default axios at `2026-09-28T08:13:56.380Z`: 28,710 bytes,
  SHA-256 `6218c93199c84005a62d17b0deebf809f888a568333cb80ed3e261ed33f50487`.
  Page title identifies Harry Connick Jr's official site; canonical URL is
  `https://www.harryconnickjr.com/tour`. The approved artist DB names
  `Harry Connick, Jr.` and points to the same domain/tour URL.
- The server-rendered tour block `.view-tour .view-empty .tour` explicitly says
  **"Harry Connick, Jr. currently does not have any upcoming tour dates."**
  There are zero configured `li.tour-item` blocks, zero event microdata nodes and
  no JSON-LD events. This is a readable explicit empty-tour state on the official
  page at observation time, not an inaccessible or unresolved client template.
- Independent saved-baseline inspection found manifest `selectors_stale` and one
  source-cache row, scraped `2026-07-25T05:45:51.277Z`, for `07.24.26` at Borgata,
  Atlantic City, NJ, US. At published clock `2026-09-28T04:05:33.582Z`, diagnostics
  show raw 1, published 0 and past-date drops 1. None of the 39,409 public concerts
  belongs to Harry Connick. The stale cached row is not a future show to recover.
- **HOLD without code changes.** The current explicit no-upcoming message gives
  no supported future event to parse. `selectors_stale` alone does not prove that
  selectors are broken. No performance date, venue, country or ticket URL is
  inferred; the US fallback is not used as location evidence. No `allowEmpty`
  change or false scraper-recovery claim is introduced.
- Captured HTML, URL/time/hash, exact empty marker, saved source/cache diagnostics
  and protected-file checks are recorded in
  `/private/tmp/concert-harry-source-20260928-evidence/source-diagnosis.json`.
  Only this journal changes; production config/runtime/tests/fixtures are intact.
  Diff and protected-file hash checks passed. Focused tests, build/lint, SSRF,
  selector ratchet, candidate replay and full suite were not run (N/A: no runtime
  candidate). No access workaround, extra collection, commit/push/PR, hosted run
  or publication occurred. Revisit when this official tour page announces explicit
  future performances; the current observation does not rule out later additions.

### 2026-09-28 — Ha*Ash official tour diagnosis, HOLD: ordinary requests timed out

- Package `vacation-20260928-concert-haash-source-27` uses a new isolated branch
  `codex/haash-source-recovery-20260928` at published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Prior journal history is preserved.
  The separate Iron Maidens, Belgrade, Jane and previous HOLD copies remain
  protected; this package does not integrate or publish their work.
- The exact configured official URL `https://ha-ash.com/tour/` was requested by
  existing guarded production-default axios. Attempt one ran from
  `2026-09-28T08:31:55.624Z` to `08:32:10.645Z`; a single same-URL retry ran from
  `2026-09-28T08:32:32.024Z` to `08:32:47.044Z`. Both failed with the existing
  15,000 ms timeout. Each attempt's metadata/error is preserved separately.
  The independent web tool also could not access this exact page.
- No response body was captured, so there is **no HTML hash**, observed page title,
  current live artist-identity confirmation or event count to report. A purported
  tour 2026–27 heading, search excerpt or configured artist name cannot stand in
  for retrieved concert evidence. No linked resource or ticket URL could be
  discovered from an actual body; no alternate domain, guessed API, browser
  workaround, authentication or access-control bypass was attempted.
- **HOLD without code changes:** no explicit future date/venue/city/country
  records can be verified from the unavailable source. This is not proof of an
  empty schedule, domain relocation or permanent outage. No date, ticket link or
  MX country is inferred from configuration/fallback. No `allowEmpty` change or
  false scraper-recovery claim is introduced.
- The only repository change is this journal. Parser/config/runtime/tests/fixtures
  are untouched. Focused tests, build/lint, SSRF test, selector ratchet, candidate
  replay and full suite are N/A and not run because no runtime candidate exists.
  Diff and protected-file hash checks passed. No commit/push/PR, hosted run,
  publication, general collection, other artist/source, global processing,
  schedule or limit change occurred.
- Request evidence, saved baseline facts and preservation checks are recorded in
  `/private/tmp/concert-haash-source-20260928-evidence/source-diagnosis.json`.
  Revisit when the same official source is ordinarily readable; any later parser
  candidate still needs explicit performance dates and reliable place evidence.
- Independent saved-baseline inspection found `artist-haash` failed with
  `selectors_stale`, no source-specific venue-cache entry and no diagnostics entry
  for `ha-ash.com`. The public catalogue already contains **14 Ha*Ash concerts**,
  4 February–21 March 2027, all from Bandsintown. These records remain untouched;
  aggregator data is not substituted for the missing official-page proof. The
  approved artist name is `Ha*Ash`, with the same configured website/tour URL.

### 2026-09-28 — The Fizz source diagnosis, HOLD: artist identity mapping is unsafe

- Package `vacation-20260928-concert-fizz-source-28` uses a new isolated branch
  `codex/fizz-source-recovery-20260928` from published release SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Prior canonical journal is retained;
  all separate dirty candidates and previous HOLD copies are protected. No pending
  candidate is integrated or published in this package.
- Guarded production-default axios read the exact configured
  `https://www.thefizzofficial.com/tour` at `2026-09-28T08:50:33.984Z`: 712,242
  bytes, SHA-256 `834367513c9eeec11f7fd06cdb85fc5d1030c5674d161991998bc3a485d1d4a0`.
  The page identifies The Fizz and gives 15 explicit dated text rows: one past
  11 September 2026 row and 14 future rows, 8 November 2026–20 November 2027.
  The old configured event selector matches zero. These observed rows are not
  automatically approved events or proof of every venue/country.
- The directly linked official biography `/bio`, captured
  `2026-09-28T08:51:12.931Z`, 891,642 bytes, SHA-256
  `398d4034d489d9f7f2577cb7bcf3bcd853e477abb38045b4f15cd65249e3d4df`, explains
  The Fizz's connection to original Bucks Fizz members, but also distinguishes
  it from Bobby G's group and records the later The Fizz rebrand. Historical
  membership/connection does not establish an unambiguous canonical identity
  mapping to either of the current approved database entries.
- **Material existing data defect:** the saved source cache has 15 `THE FIZZ` rows;
  all 14 future rows appear in the exact saved public catalogue as **The Firm**,
  with The Firm's MBID `c08ced1f-d248-4368-90e5-bf579b3bf5de`, Spotify and socials.
  Source diagnostics are raw 15, published 14, one past-date drop. Thus a healthy
  published count would conceal an incorrect artist attribution.
- Approved data has a `Buck's Fizz` entry with thefizzofficial.com website/tour URL
  and no MBID, a separate `Bucks Fizz` entry with MBID
  `81b9c72d-8d46-446b-a420-ba618d89636e` and alias `Buck's Fizz`, and a separate
  `The Firm` entry. There is no approved canonical or alias `The Fizz`. Independent
  read-only review confirmed the mismatch and identified the matcher's fuzzy tier
  allowing two edits as the path to The Firm. Forcing the parser to emit the
  website-linked `Buck's Fizz` name would technically choose that exact entry,
  but would silently encode an unresolved identity decision in a source parser.
- The directly linked `https://www.winterpride.com/` was also captured normally at
  `2026-09-28T08:51:14.524Z`: 189,537 bytes, SHA-256
  `19f597817a085a75902257ee18263b4634868f7aa8eddabe0589150aa2e5498c`.
  Its visible current programme identifies Winter Pride, 2–8 November 2026,
  Maspalomas, Gran Canaria/Canary Islands; the title still mentions 2025 and is not
  used as current event evidence. The cache's UK / published GB for Maspalomas is
  unsupported. No replacement country, exact stage or ticket link is invented.
- **HOLD without code changes:** current dates are readable, but approved artist
  identity is unresolved. Keeping The Fizz continues the wrong match; forcing a
  different name solely in the parser is not a verified identity repair. A future
  separately scoped correction must establish The Fizz's canonical record/mapping
  and regression-check all 14 affected public records and the Maspalomas country.
  Remaining venue/country checks stop at this identity blocker; they are not
  claimed complete. No global matcher or artist DB edit is made in this package.
- `row-attribution.json` links each observed dated line and actual href to its
  saved raw row and exact public record (14 identity mismatches, one past row).
  This is diagnostic attribution, not a pipeline replay or change to public data.
  Evidence and independent review:
  `/private/tmp/concert-fizz-source-20260928-evidence/source-diagnosis.json`.
  Only this journal changes. Diff and protected-file hash checks passed; focused
  tests/build/lint/SSRF/selector gate/replay/full suite are N/A, not run (no runtime
  candidate). No commit/push/PR, hosted run, publication, general collection,
  other artist/source, schedule or limit changes occurred.

### 2026-09-28 — Authorized release of verified official-source candidates

- Alex explicitly requested: “Публикуем и проверяем как отработает”. This replaces
  the earlier local-only delivery boundary for Iron Maidens, Belgrade season and
  the four Jane McDonald official-link values. Source HOLD diagnoses remain HOLD.
- Composed on main `a2a47fbbb7a2905c99105ea87ee77c23f65c7b27` in an isolated branch;
  original dirty candidates remain unchanged. No schedule, quota, global matcher
  or normalization changes. The Jane data patch preserves intervening enrichment.
- Iron Maidens and Belgrade use their individually verified parsers and fixtures.
  Jane updates the proven official website/tour URL; concert recovery is not claimed.
- Release gates: combined tests, build, lint, production SSRF policy, integrity and
  selector ratchets, offline replay, then exact-PR-head hosted verification.
  After merge, run the ordinary collector and verify Actions SHA, source cache
  fingerprints/freshness, rejection counts and deployed Pages artifact equality.
- Existing unresolved The Fizz/The Firm identity and Maspalomas-country defect is
  explicitly retained as a separate repair; no unverified identity fix is released.
- Combined validation passed: 624 tests, zero failures, one intentional SSRF skip;
  independent production SSRF test passed 1/1; build passed; lint zero errors
  (106 existing warnings); artist integrity 141 <= baseline 141; selector count
  127 <= 131. `node --import tsx` supplied the equivalent offline integrity/selector
  checks after the CLI IPC listener was sandbox-blocked.
- Combined offline replay reproduced the saved public baseline and compared the
  current main artist DB with the release DB: 39,409 -> 39,444 (+10 Iron Maidens,
  +25 Belgrade), no removed or modified existing records, zero network attempts.
  Independent integration review passed, including exact parser/fixture hashes
  and preservation of intervening enrichment. Hosted result remains pending.

### 2026-09-28 — Official-source release published and verified

- PR [#162](https://github.com/Cartograf666/concert-for-travelers-api/pull/162) merged
  as `d53e0e436afd8aeb431f07a13c79b992410cffd1`. All 13 merged files matched the
  locally tested candidate byte-for-byte. GitHub Node 22 verification run
  `36401313334` passed at PR head `887561bcc0639d485786a2a2690e435530a4df2c`.
- Manually dispatched Daily Concert Scrape
  [36401607058](https://github.com/Cartograf666/concert-for-travelers-api/actions/runs/36401607058)
  checked out the exact release SHA; scrape and Pages deployment both succeeded.
  Published status generated `2026-09-28T09:13:53.453Z`. The deployed root HTML
  and `status.json`, `index.json`, `concerts.json`, `artists.json` equal the
  completed run artifacts. The health gate was eligible and actual deployment
  is separately confirmed by the successful deploy job and public reads.
- Iron Maidens: 10 fresh raw events -> 10 published, zero processing drops or
  merges. Belgrade: 25 fresh raw -> 25 published, zero drops or merges. Both
  source config hashes and cache fingerprints match the released parser/config;
  fresh `scrapedAt` and `verifiedAt` prove extraction instead of cache-only reuse.
  Every published date/artist/venue/city/country/time matches the checked replay.
- Jane McDonald's corrected website is present in public `artists.json`. Her
  source still returns `selectors_stale` and publishes zero concerts; link repair
  is verified, concert collection remains unresolved.
- Overall catalogue: 39,409 -> 39,529 (+120 net), 94 countries. Venue cohort:
  93/147 -> 100/147 succeeded, 23 changed and 77 unchanged; 47 failures remain.
  All source-level raw/published/duplicate/drop accounting reconciles. Schema
  rejects remain 217, including 191 `country:too_big` issues.
- Fleet health remains DEGRADED. Three stale-cache sources remain (Harry Connick
  Jr, Philip Labonte, Barby Tel Aviv). The separate artist/Bandsintown/Eventbrite
  cohorts were not rerun; their existing manifest is run `36374621592` at SHA
  `00ad551019aaea043ac09ab093a955b694d9eb4c`. Intervals and limits are unchanged.
- Known The Fizz/The Firm attribution issue remains a separate HOLD. Original
  candidate/HOLD worktrees retain their prior heads, dirty state and file hashes.
  Post-release automatic main commits changed artist enrichment/repair history;
  this evidence refers to the exact collector/deploy SHA above.
- Local release evidence: `/private/tmp/concert-publish-sources-20260928-evidence/`
  (`release-evidence.json`, `publication-verification.json`, reports and logs).
- Event identity comparison (artist/date/city) found 147 additions and 27 removed
  prior identities, net +120. The 27 removals are outside the three changed
  sources: Chicago 14, Ticketmaster 10, Bandsintown 1, Tvornica 1, Lexington 1.
  Disappearance from a fresh feed is not treated as proof of cancellation.
