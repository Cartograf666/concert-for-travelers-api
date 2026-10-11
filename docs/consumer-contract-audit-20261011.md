# Consumer contract audit — 2026-10-11

Read-only source inspection of the sibling `concerts-for-travelers` application,
plus execution of its actual pure Cartograf adapter against captured published
records. Its dirty checkout was preserved. No server cutover, consumer edit,
provider request, credentials inspection or deployment was performed.

The inspected `server/src/services/sources/index.ts` always enables Ticketmaster
and Cartograf, adding Bandsintown and JamBase when their credentials are configured.
This establishes code behavior, not which credentials a running deployment has.
The merge code prefers Ticketmaster/Bandsintown/JamBase and retains Cartograf
profile/coordinates only to fill gaps. A static-only migration therefore requires
an actual live coverage comparison; it is not justified by the present audit.

## Observed compatibility gap

The consumer's `cartograf.ts` generates ASCII-only slugs with non-alphanumeric
runs replaced by dashes. The API's current `src/pipeline/process.ts` instead
normalizes accents, removes some punctuation and retains non-Latin letters.
On the published 2026-10-10 index (7,044 artists), the actual functions disagree
for **334 names**, including **21 empty consumer slugs**. Examples:

| Name | Consumer slug | API slug |
| --- | --- | --- |
| 10,000 Maniacs | 10-000-maniacs | 10000-maniacs |
| 3OH!3 | 3oh-3 | 3oh3 |
| A*Teens | a-teens | ateens |
| A.R. Rahman | a-r-rahman | ar-rahman |
| ADÉLA | ad-la | adela |

This is a source-level request-path mismatch, not a claim that 334 artists have
no concerts or a measurement of live users. The consumer intentionally skips
empty/shared slugs and converts an HTTP 404 to an empty result. Those safeguards
prevent identity leakage but cannot recover a wrong request path.
Consumers should use the exact published `artists.json` directory slug for a
canonical artist. Changing API filenames to emulate an outdated consumer would
break current clients and can introduce collisions, so no API slug/schema change
was made. A consumer-side correction remains outside this repository's write scope.

## Actual projection check

The unmodified consumer `mapCartografEvents` preserved all 72 Blue October and
34 Teenage Fanclub captured public records: **106 → 106**, with artist/date/city/
venue/ticketUrl equality asserted. This verifies those inputs and the existing
projection only. It is not a full catalogue or live provider comparison.

`ticketUrl` remains compatible with the API contract: the artist website has
priority when available, with the raw ticket/event link as fallback. The client
currently labels that field “Ticket”/“Билет”, so the label can imply a ticket vendor
even when it is the artist homepage. That UX correction belongs to the sibling
application; no breaking API field rename was introduced.

Reproduction and exact input/source hashes are retained in the stage evidence:
`/Users/alex/agent-hub/concert-data-quality/coordinator/work/consumer-contract-check.mjs`
and `consumer-contract-result.json`. Execute from the coordinator with
`node --import tsx /Users/alex/agent-hub/concert-data-quality/coordinator/work/consumer-contract-check.mjs`.

Still unknown: complete market denominator, running consumer credentials,
live provider-only events, actual deployed revision and end-user runtime results.
No server migration, provider limits or publication change is proposed here.
