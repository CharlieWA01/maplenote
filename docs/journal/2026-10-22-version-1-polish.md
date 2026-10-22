# 2026-10-22: Version 1 polish, and 1.0.0

## Goal
Charlie picked Maplenote back up alongside Stargazer. After a roadmap review
the choice was to finish Version 1 (step 6, "polish") first: no AWS, no
cost, nothing shared with Stargazer's work. Finishing it makes the app
1.0.0.

## What was done
- **Roadmap review:** what's done (editor, S3, Lambda, guest mode, About box)
  and what's left (polish, moving to workloads-prod behind CloudFront,
  Cognito). Found the roadmap's "Next" row was stale: it still said SCPs and
  the portfolio site, both done in `cloud-homelab` on 2026-10-20. Fixed here.
- **Sign out button** (hosted only). The page learns there's a password
  from a new `can_sign_out` field on `/api/files`. Clicking it saves every
  tab, asks before losing anything it couldn't save, removes the signed-in
  drafts, device handles and open-tab list from the browser, then goes to
  `/logout`. `/logout` no longer needs a valid session. See DECISIONS.md.
- **Keyboard shortcuts:** Ctrl+S saves, Alt+W closes the tab, Ctrl+E
  switches Edit and Preview. Ctrl+W was the ask, but Chrome never gives it to
  a page, so Alt+W instead. Buttons' tooltips name their shortcut, and the
  README has a table.
- **Guest "Download all":** a button in the guest bar saves every note as
  `maplenote-notes-YYYY-MM-DD.zip`, folders and unsaved edits included. The
  zip is built in the page (`makeZip()`, `crc32()`), with no library.
- **Icon:** `static/favicon.svg`, a note on maple orange, in the browser tab.
- **Docs:** README (three ways to run it, shortcuts, sign out), the welcome
  note (mentions Download all and the shortcuts), roadmap, PORTFOLIO,
  CLAUDE.md, changelog 1.0.0.

## Problems and fixes
- The first version of a sign-out test passed even with its protection
  removed: it checked that no draft was written back when leaving the page,
  but Chrome doesn't reliably finish a browser-database write started while
  the page is being left, so the test couldn't tell. It was changed to store
  a draft first and check that signing out removes it, which does fail when
  the clean-up is removed. The "don't write drafts while signing out" guard
  stays, as a belt-and-braces measure, without a test of its own.
- `/logout` answered 401 once the session had expired, so a "Sign out" click
  on an old tab would have shown an error. Now it's open (it only deletes
  cookies).

## How it was verified
- `python -m pytest`: 146 passed (5 real-S3 tests skipped, as usual).
- New tests: `tests/browser/test_shortcuts.py` (Ctrl+S with autosave off;
  Alt+W closes a tab, not the scratch pad, and still asks about unsaved
  edits; Ctrl+E both ways; no sign-out button locally), sign-out tests in
  `test_password.py` (saves, then leaves no drafts, handles or tab list;
  asks when a save is refused; "anyway" removes the draft), the .zip test in
  `test_guest.py` (Python's `zipfile` opens it, checks every checksum, and
  finds a UTF-8 folder name and the unsaved edit), and two API tests
  (`can_sign_out`; `/logout` after the session ended).
- Proved they can fail: a wrong CRC, a skipped tab-list clean-up, a skipped
  draft clean-up, Ctrl+S, Ctrl+E and the scratch-pad message each disabled
  in turn; each failed its test, then the code was restored.

## Impact
Version 1 is done: 1.0.0. Visitors get a nicer first glance and a way to keep
their notes; Charlie gets a real sign-out that's safe on a borrowed
computer. No AWS change and no cost. Next on the roadmap: Maplenote in
workloads-prod behind CloudFront, then Cognito (both need Charlie's
`terraform apply`).
