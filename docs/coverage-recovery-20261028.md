# Concert coverage recovery — 28 October 2026

Local reviewed candidate for Alex's request to recover 40 audited missing dates,
repair demonstrated recurrence causes, and prepare a realistic source/affiliate
plan. **No production release or collection dispatch has occurred.**

## Result and identity limits

The authoritative expected set is the original read-only
`reports/coverage-20261028/confirmed-missing.csv` (40 rows). Final combined code
`70a61891637ec1588cd82c1479e11c2c0d74d86a` reproduces all 40 artist/date/country
targets in the normal published format using captured actual source observations.
The replay uses real normalization, artist matching, conservative deduplication,
geocode cache and publishers; it makes no network requests. It is not a live
production collection or proof of future source completeness.

The immutable producer input is the verified Actions artifact 12765444995 from
run 40571077991, SHA-256
`3a833425cdd5c448625e0671ac30baa1cc2f59cc8c56cea2093674684c93bfc6`.
Baseline equivalence reproduced the actual 52,973 published rows exactly from
106,686 raw rows. Adding 79 captured actual source observations produces 106,765
raw → 53,027 published rows. All 40 targets were absent from baseline; each target has one final
published row retained from the scoped source-checked candidate after all fixes.
22 targets have a ticket link; 18 do not. No link or date was invented.

38 targets have primary-source **inputs**; King Gizzard 22/23 June 2027 rely on
fresh Bandsintown. The normal whole-record winner may be Bandsintown even where
primary inputs exist. Seventeen targets retain venue/city labels different from
the original audit. Native labels are not rewritten to manufacture exact matches.
King Gizzard on 9 June 2027 is reconciled to one complete primary record:
Radiant-Bellevue / Caluire et Cuire. A finite guard binds exact artist identity,
source event/ticket IDs, venue, date, country and the captured single 19:00 session.
Different sessions/IDs/times retain separate records; no global city alias is
introduced. Identity is inferred from independent agreement, not a shared provider
ID. The official ticket page was accessible; the BIT ticket redirect was blocked.
The whole-catalogue delta from the pre-identity result is exactly removal of this
one BIT duplicate; zero other rows were added or changed. The 54 extra output
rows over baseline are not 54 independently verified new unique concerts.

## Changes

Eleven normal-loader configs/custom parsers cover Hard-Ons, Godspeed You! Black
Emperor, Paula Fernandes, Iron Maiden, The Bluetones, Matthew Good, two Muse
festival pages and three King Gizzard primary pages. They read source dates on
ordinary runs; the audit's fixed dates exist only as expected test evidence.
Paula's entry is a current-tour announcement, not evergreen future-tour discovery;
Hard-Ons coverage is limited to this organizer. Unavailable primary pages were
not bypassed. Source fixtures, capture provenance and parser regression tests are
committed with the code. No trust-registry exception was added.

The collector retains last-good events and successful `verifiedAt` on unavailable
or incomplete feeds. Unknown rows do not certify an empty schedule. Malformed
active rows in Iron Maiden/Bluetones reject the source and preserve the whole
saved cache; explicitly cancelled rows are handled separately. Conflicting
Hard-Ons cancellation copies fail revalidation in either page order. A run with
zero tour configs still reaches independent provider stages. Health reporting
exposes overdue/unknown successful verification, including active artists.

D-RECOVERY-003 changes active reservation from 20% to 50% while retaining at least
50% globally oldest attempts under contention, interleaving and carryover.
800/day, 1.1-second delay, six-day minimum revisit and failure guards are unchanged.
The saved-cache 120-run simulation changes current-active p95 age 8 → 5 days and
current-cold p95 28 → 33 days. It assumes successful responses and no new events;
it is a capacity comparison, not a live six-day SLA. A 20,819-artist roster cannot
all be refreshed every six days with an 800/day cap.

## Verification

- Full integrated `npm test`: 980 total, **979 PASS, 0 FAIL, 1 intentional SKIP**;
  process exit 0. Both new parser and actual run-artists cache regressions included.
- `npm run build`: PASS; `npm run lint`: exit 0, 0 errors / 101 existing warnings.
- `npm run test:ssrf-policy`: 1/1 PASS, production policy without local-host override.
- Frozen UTC combined publisher replay: exit 0, zero network attempts; final
  target receipt verifies 40/40, zero targets with multiple rows and source-label limits.
- Independent Terra round-two review: the three initial P2s are verified fixed;
  the Radiant-Bellevue duplicate was its remaining P2. Final Terra round-three
  review closes it with no new code blockers and independently confirms the exact
  catalogue delta and final hash. Its stale receipt counter finding was corrected
  and rechecked (zero targets with multiple rows). Claude Opus review failed
  authentication before checking anything.
  No failed reviewer attempt is counted as a passing review.

Detailed reproducible evidence lives at
`/Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/`:
`replay-coverage.mjs`, `replay-input/`, `baseline-equivalence.json`,
`additional-source-observations.json`, `additional-source-provenance.json`,
`replay-candidate-final/summary.json`, `recovery-receipt-final.json`,
`hub2-release-tests.log`, `hub2-release-build.log`, `hub2-release-lint.log`,
`hub2-ssrf.log`, `hub2-release-replay.log`, `verify-final-recovery.py`,
`occurrence-identity-REPORT.md`, `review-round3-REPORT.md`, and the other worker reports.
The replay JSON is local evidence, never injected into production caches.

## Source automation and affiliate preparation

See [the proposed plan](artist-source-automation-plan-20261028.md): reuse existing
artist/site discovery, standard formats, shared provider fetching and exception
queues; propose a measured 100-artist pilot before a full-base expansion. The
pilot/new platform is a proposal, not accepted implementation scope. Social APIs
have access limits; data access and affiliate rights are separate.

The prepared English Ticketmaster/Impact application is in
`/Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/affiliate/application-draft.md`.
A Ticketmaster Developer registration email exists; affiliate approval/Publisher
ID is unconfirmed. The application discloses the public static JSON distribution
and asks whether it is allowed, plus attribution/SharedID/integration conditions.
Actual country, individual/company and provider eligibility remain required.
Impact may require identity document/selfie and applicable tax documentation;
Russia admission/payout is unknown. A foreign bank account alone does not resolve
residence/entity eligibility. No contract, account, upload or outbound message was
submitted. An owner decision with real applicant data is required for those steps.

## Delivery boundary and next action

Candidate branch `worktree-concert-coverage-recovery-hub-2` preserves the original
dirty main checkout and predecessor strategy artifact. No push/main merge,
deployment, cron/provider-budget change, account/auth repair or agreement acceptance.
Independent re-review is complete. Alex can now decide whether to release this
specific local package. Release must run the ordinary collection and compare the live
published subset/health; the frozen replay does not claim that release occurred.
The proved venue/locality pair is resolved narrowly. Paula future-tour discovery
and the two aggregator-only target inputs remain explicit source limits; neither
is silently solved by guessed aliases or dates.

## Recipient check (author self-check; independent code review separate)

Product owner: this report separates recovered local evidence from production,
shows the remaining source limits and active/cold refresh tradeoff, and points to
the plan and concrete application draft. The next choices are release of a
specific reviewed package and real applicant details/consent for onboarding;
accepting the proposed 100-artist pilot is a different product decision.

Maintainer: the code head, expected CSV, immutable producer identity, source
fixtures, replay helper, final machine receipt and gate logs identify inputs and
actual checks. To reproduce the scoped publisher result, run the following from
the final candidate worktree (requires existing project dependencies):

```sh
TZ=UTC node --import tsx /Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/replay-coverage.mjs \
  /Users/alex/code/concert-for-travelers-api/.claude/worktrees/concert-coverage-recovery-hub-2 \
  /Users/alex/code/concert-for-travelers-api/reports/coverage-20261028/producer \
  /Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/replay-input \
  /Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/replay-candidate-final \
  /Users/alex/agent-hub/concert-coverage-recovery/coordinator/work/additional-source-observations.json
```

Affiliate operator: use the prepared text only after confirming real country,
entity and account, provider data-distribution permission and action-time consent.
A developer registration is not affiliate approval, and a tracked link is not
proof of commission or payout. These necessary missing inputs remain visible.
This synthetic check is the author's own pass over recipient tasks; it does not
replace independent code review, real professional advice or owner acceptance.
