# 2026-10-19: A documentation standard for all projects

## Goal
Charlie wanted a lasting record across projects of what was worked on, the
decisions and why: something to use for presentations, a resume, job
interviews and personal reference, automated as much as possible. It had to
be set up while the details of Maplenote's first two days were still fresh.

## What was done
- Took the practice Charlie had started in the `cloud-homelab` repo (journal
  entries with "In my own words", decision log with costs, STAR interview
  stories, runbooks) and wrote it down as `docs/DOCS-STANDARD.md`, identical
  in both repos.
- **Backfilled Maplenote:** four journal entries covering 2026-10-17/18, six
  interview stories, a one-page `docs/PORTFOLIO.md` with draft resume bullets,
  a runbook for daily use and testing PRs, and `docs/HISTORY.md` with every
  change so far.
- Reformatted `docs/DECISIONS.md` to the shared format (oldest first,
  `## date: title`) and corrected four dates that were recorded in UTC
  instead of Charlie's time zone.
- **Automation:** the "Documenting is part of every task" section in
  `CLAUDE.md`; a PR template with the docs checklist; a `docs-check` workflow
  that fails a PR changing code without touching `docs/`; a `docs-history`
  workflow that records each merged PR in `docs/HISTORY.md`.
- New rule: Claude signs its GitHub comments with "— Claude", because they
  post under Charlie's account and the PR history should show who said what.

## Problems and fixes
- **Claude's PR comments looked like Charlie's.** Found while gathering the
  history: Claude posts through Charlie's GitHub connection. Fixed going
  forward with the signature rule; earlier comments are identifiable by
  context (they report commits and test results).

## How it was verified
The `docs-check` logic was run locally against code-only, docs-only, mixed
and labelled cases; the `docs-history` append step was run against a copy of
`docs/HISTORY.md`, including the time-zone conversion and a title containing
`|`. Both workflows run for real on this PR: `docs-check` when it opens, and
`docs-history` when it's merged.

## Impact
Every future PR in both repos leaves a written trail, and the first two days
of Maplenote are captured in a form ready for a resume or interview. Cost:
one extra bot commit on `main` per merge.
