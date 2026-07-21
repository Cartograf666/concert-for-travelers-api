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

*(Log trimmed 2026-07-21 -- entries through 2026-07-08 archived to git history;
see `BACKLOG.md` for what's actually shipped/in-progress, this log is only for
"is someone else mid-edit right now" signal.)*

- 2026-07-21: scraper-degradation remediation (`src/scripts/prune_dead_scrapers.ts`
  new, `src/engine/llm_extraction_fallback.ts` new, wired into `src/engine/runner.ts`);
  bootstrapped `.ai/architecture.yaml` + `.ai/architecture-baseline.yaml`
  (architecture-governance skill); archived two fully-superseded task briefs to
  `docs/archive/`.

## Where to look for what's owned by what

- `scrapers/*.json` -- venue configs (daily schedule). Per `docs/ADD-VENUE-SCRAPERS.md`,
  additions here are meant to parallelize cleanly (one venue = one file, low collision risk).
- `scrapers/artists/*.json` -- artist tour-page configs (daily schedule since
  `artist-scrape.yml`'s cron moved weekly -> daily, separate workflow). Same
  low-collision-risk shape as venue configs. Don't move these into the
  top-level `scrapers/` dir -- keeping them separate is what keeps the daily
  job's timeout budget safe.
- `data/artists/shard-0.json`..`shard-7.json` -- the artist whitelist DB
  (sharded by name's first character; replaced the single `data/approved_artists.json`
  file this note used to reference). Owned by `src/pipeline/artistDb.ts`'s
  `loadApprovedArtists`/`saveApprovedArtists` -- every read/write goes through
  that module, don't hand-edit the shard files or read/write them directly from
  a new script. Large diffs here are usually a live enrichment run, not a merge
  conflict.
- `src/pipeline/process.ts`, `src/schemas/*.ts`, `src/engine/runner.ts` -- shared
  core logic. Higher collision risk if two sessions touch the same function;
  check `git log -p <file>` for very recent commits before large edits here.
- `.ai/architecture.yaml` -- provisional architecture manifest (layer boundaries,
  dependency rules). Only edit for an intentional architecture decision, not
  because a change happened to cross a boundary.
