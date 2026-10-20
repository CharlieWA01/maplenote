# 2026-10-20: A version number and changelog inside the app

## Goal
Charlie asked for "a version number and history visible within the app
somewhere". Make it something a visitor can glance at, that Charlie can use
to tell which build is live, and that works in guest mode.

## What was done
- **One place for the version:** `static/changelog.md`. Its first
  `## 1.2.3 · YYYY-MM-DD` heading is the current version; the page reads it
  from there, so there's no second copy to forget. The rules for the
  numbers are in DECISIONS.md (same date).
- **The history, seeded from the real record:** every change that a user
  would notice, from `docs/HISTORY.md` and the git log, numbered 0.1.0
  (step 1, the bare editor) to 0.10.0 (guest mode), plus 0.11.0 for this
  change. Docs-only and test-only PRs (#1, #6–#8, #10–#12, #15–#18) don't
  get a version, since nothing changed for someone using the app. Dates
  are the merge dates in HISTORY.md.
- **About box (`static/index.html`, `app.js`, `style.css`):** the version
  sits at the far right of the status bar (`v0.11.0`). Clicking it opens a
  dialog with the version, the build ("Built from commit 1a2b3c4 on
  2026-10-20 01:02 UTC", or "Running from the source folder" locally) and
  the changelog rendered with markdown-it (raw HTML off, like the preview).
  It only fetches static files, so guests get it too and the files API is
  never called.
- **The commit baked into the image (`Dockerfile`):** two build arguments,
  `MAPLENOTE_COMMIT` and `MAPLENOTE_BUILT`, are written into
  `static/build.json` while the image is built. `deploy-sandbox` passes the
  commit (`$GITHUB_SHA`) and the time. `static/build.json` is in
  `.gitignore`; it only ever exists inside an image.
- **A better deploy check:** after updating the function, `deploy-sandbox`
  now also fetches `static/build.json` from the live URL and fails unless it
  names the commit being deployed. Before, the check proved the app
  answered and wanted a password, but not that it was the *new* app.
- **CI:** the `tests` workflow's image job builds with a test commit and
  checks the running container serves it in `build.json`.
- **Keeping it up to date:** `CLAUDE.md` and the PR template now ask for a
  changelog entry whenever a PR changes what a user sees, and a test fails
  if the entries are badly formed or out of order.

## Problems and fixes
- The changelog's hard-wrapped lines came out as separate lines in the
  dialog: notes are rendered with `breaks: true` (a single line break is a
  break, as in Obsidian). The About box uses its own markdown-it instance
  with the default, where a single line break is a space.
- Docker couldn't pull the Lambda adapter image from this cloud session
  (no route to its download host), so the image build was checked by the
  `tests` workflow on GitHub instead; the `printf` line that writes
  `build.json` was checked on its own in a shell.

## How it was verified
- `python -m pytest`: 134 passed (5 real-S3 tests skipped, as usual).
- New tests: `tests/browser/test_about.py` (the version in the status bar
  matches the changelog; the dialog lists every entry; "source folder"
  without a build record; the commit and time with one; a guest sees it
  all with no request to `/api/`) and
  `test_changelog_entries_are_well_formed_and_newest_first` in
  `tests/test_api.py`.
- Proved they can fail: rendering the changelog's intro and breaking the
  "no build record" branch failed the browser test; renumbering 0.9.0 to
  0.10.1 failed the changelog test ("(0, 10, 0) is listed above (0, 10, 1)
  but isn't higher"). Both restored.
- Looked at the dialog in Chromium at 1200×800.

## Impact
Anyone using Maplenote can see what version it is and what's new; Charlie
can see which commit is live without opening AWS. Each deploy now proves it
replaced the running code. Cost: none (two small static files; the
changelog is fetched once per page load). One more thing to keep up to date
per PR, backed by a test and the PR template. The commit hash is visible to
anyone who opens the page; it reveals nothing while the repo is private,
and it's meant to be public later anyway.
