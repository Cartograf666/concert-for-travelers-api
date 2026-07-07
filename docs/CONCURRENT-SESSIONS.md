# Heads-up: multiple AI sessions work on this repo concurrently

This repo is sometimes worked on by more than one Claude Code session at the
same time (same user, same machine, same working tree) with no explicit
handoff between them. Commits from one session may include files another
session was mid-edit on, since both read/write the same files on disk. This
note exists so a session picking this file up mid-work has *some* signal about
what else might be in flight, instead of none.

**This is not a lock file and not enforced by anything.** It's a courtesy note.
Update the "Recently active" section below with a short entry when you start a
non-trivial multi-step task, and check it before starting your own work if you
suspect another session might be active.

## Recently active

- 2026-07-07: date-parsing / artist-matching correctness audit (`src/pipeline/process.ts`,
  `src/schemas/*.ts`) + Lisbon/Bangkok scrapers + engine hardening (circuit
  breaker, playwright, geocoding, self-heal PR gate, deploy health-gate). See
  commits `720063e`..`22d34b4`. Also touched: `docs/ADD-VENUE-SCRAPERS.md`
  conventions were read and followed, not modified.

## Where to look for what's owned by what

- `scrapers/*.json` -- venue configs. Per `docs/ADD-VENUE-SCRAPERS.md`, additions
  here are meant to parallelize cleanly (one venue = one file, low collision risk).
- `data/approved_artists.json` -- owned by the enrichment workflows/scripts
  (`enrich_auto.ts`, `enrich_wikidata_bulk.ts`, `enrich_sites.ts`). Don't hand-edit;
  large diffs here are usually a live enrichment run, not a merge conflict.
- `src/pipeline/process.ts`, `src/schemas/*.ts`, `src/engine/runner.ts` -- shared
  core logic. Higher collision risk if two sessions touch the same function;
  check `git log -p <file>` for very recent commits before large edits here.
