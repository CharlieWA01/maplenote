# 2026-10-19: Dropping "In my own words"

## Goal
Remove the "In my own words" section from the journal, at Charlie's request
during the status and roadmap discussion after Maplenote went live.

## What was done
- Checked every journal entry in `maplenote` and `cloud-homelab` first: all
  of them had only the placeholder line, so nothing written was lost.
- Removed the heading and placeholder from every entry and from the
  template in `docs/journal/README.md`.
- Removed the rule from `CLAUDE.md` and `docs/DOCS-STANDARD.md` so later
  sessions don't add it back. The standard stays identical in both repos.
- Recorded the change in `docs/DECISIONS.md` and marked the original
  documentation-standard entry as partly superseded. Older journal entries
  that mention the section as part of the standard were left as they were,
  since they describe what was true then.

## Problems and fixes
None.

## How it was verified
`grep -rn "own words"` over both repos: the only matches left are the
decision entries, historical journal text, and the unrelated phrase
"rehearse them in your own words" in the interview stories.

## Impact
No change to the app. One less section in every journal entry.
