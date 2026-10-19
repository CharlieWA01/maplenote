# Interview stories

Short STAR stories (Situation, Task, Action, Result) drawn from building
Maplenote. Claude drafts the facts; rehearse them in your own words.
See `docs/DOCS-STANDARD.md`.

**Tags:**
- **Design**: architecture and trade-offs
- **Reliability**: not losing or corrupting data
- **Security**: protecting the user and their files
- **Process**: git, code review, documentation, working with an AI agent

**How it was built, said plainly:** Maplenote was built with Claude Code as a
pair programmer. I set the requirements and direction, made the design
decisions, reviewed every pull request and tested on my own hardware; Claude
wrote most of the code and drafted the docs. Be ready to explain any part of
the architecture and why it's that way. That's what these stories are for.

---

## Choosing a design that survives the move to the cloud
**Tags:** Design

- **Situation:** My editor ran as a Python server on my Chromebook. I wanted
  it to open files from anywhere on the device (Downloads, Google Drive, USB),
  and I'd decided I wanted to host it on AWS eventually.
- **Task:** Choose between letting the server read extra folders, or letting
  the browser open files itself with Chrome's File System Access API.
- **Action:** Asked where each option's files would live once the server was
  in the cloud. Server folders would be on the cloud server, not my device;
  the browser picker always opens the user's own files. Chose the browser
  approach, accepted its trade-offs (Chrome/Edge only for saving back, with a
  download fallback elsewhere; a one-click re-permission after a refresh),
  and parked the server-folder option.
- **Result:** Device files open and save in place today, and the feature will
  keep working unchanged when the server moves to AWS. The same conversation
  produced the cloud-readiness plan.

## No silent overwrites: conflict detection
**Tags:** Reliability, Design

- **Situation:** With autosave coming, the same file open in two tabs, or
  later on my phone and my Chromebook against one cloud server, could
  silently overwrite each other's changes.
- **Task:** Make sure a save never destroys changes it hasn't seen, without
  making everyday editing annoying.
- **Action:** Every file gets a version (a SHA-256 fingerprint of its
  contents). Each save sends the version it started from, and the server
  refuses a stale save with HTTP 409. The page then offers *Load their
  version*, *Keep mine* or *Save mine as a copy*. If there are no local edits
  it simply reloads. Crash-recovery drafts remember their version too, so
  restoring an old draft can't overwrite a newer file either. Built it before
  hosting, because retrofitting it later is much harder.
- **Result:** A tested two-tab scenario that would have lost data now asks
  the user instead. It's the same optimistic-concurrency idea used by
  HTTP ETags and S3 conditional writes, which suits the planned S3 storage.

## Defence in depth for a Markdown preview
**Tags:** Security

- **Situation:** The Markdown preview turns file contents into HTML, and
  files can come from anywhere, including a downloaded note. The page itself
  has permission to save files, so an injected script would be dangerous.
- **Task:** Make the preview safe against malicious files without losing
  normal Markdown features.
- **Action:** Two independent layers: the Markdown renderer runs with raw HTML
  disabled (HTML in a note is shown as text, `javascript:` links aren't
  linked), and the server sends a Content-Security-Policy so the browser only
  runs scripts served by Maplenote itself. Tested with a note full of classic
  injection payloads (`<script>`, `<img onerror>`, `javascript:` URLs).
- **Result:** Every payload rendered as plain text and nothing executed; the
  policy also blocks framing (clickjacking) at no cost to features.

## Changing a design decision in code review
**Tags:** Process, Reliability

- **Situation:** Early on I said I didn't want "unsaved changes" pop-ups.
  Later, autosave became optional, and while reviewing that pull request I
  noticed that with autosave off, closing a tab threw away edits silently.
- **Task:** Decide whether the original requirement still made sense.
- **Action:** Questioned it on the PR. We traced the requirement back to its
  assumption (autosave always on), agreed it no longer held, and changed the
  design: warn only when edits won't be autosaved (Save / Don't save / Cancel,
  plus the browser's leave-page warning). The decision log records the change
  and marks the old entry superseded rather than deleting it.
- **Result:** The behaviour matches what users expect from any editor, and the
  record shows why it changed, not just that it did.

## Supply-chain caution with third-party code
**Tags:** Security, Process

- **Situation:** The app depends on two JavaScript libraries (CodeMirror and
  markdown-it) and must work offline with no build step for the user.
- **Task:** Include them safely and reproducibly.
- **Action:** Bundled ("vendored") them into committed files, with the recipe
  (exact pinned versions, lockfile, build command) in the repo and a check
  that rebuilding reproduces the identical file. When the newest markdown-it
  release was only two days old, pinned the newest one that had been out for
  five weeks, and made "prefer releases a few weeks old" a project rule.
  License texts for everything bundled are kept alongside.
- **Result:** No CDN dependency, no network needed at runtime, an auditable
  upgrade path, and a deliberate buffer against freshly published bad
  releases.

## Learning git and GitHub by shipping
**Tags:** Process

- **Situation:** I'd understood git vaguely for years but never really used
  it, and found it intimidating.
- **Task:** Learn it on a real project instead of from tutorials.
- **Action:** Set up the GitHub CLI, then learned each concept when it was
  needed: clone, pull, commits as snapshots, revert vs. reset, branches, then
  pull requests. From the first PR on, every change went through a branch I
  checked out and tested on my Chromebook before merging, and I left review
  comments that led to real changes.
- **Result:** Five reviewed and merged PRs in two days, a clean history, and a
  workflow I now use for my AWS infrastructure repo too.

## Proving the tests work by breaking the app
**Tags:** Reliability, Process

- **Situation:** All testing so far had been throwaway scripts in Claude's
  session, gone afterwards. The next change, a storage layer, would touch
  how every file is read and saved.
- **Task:** Put a lasting safety net in place first, and make sure it would
  actually catch real bugs rather than just pass.
- **Action:** Wrote 62 tests in Python: API tests for every safety rule, and
  browser tests that replay real scenarios (two tabs conflicting, crash
  recovery, malicious Markdown, device files). Made GitHub Actions run them
  on every PR. Then sabotaged three protections on purpose (the conflict
  check, the preview's HTML filter, the workspace path check) to confirm the
  tests failed each time.
- **Result:** 5, 1 and 6 tests failed for the three sabotages and all 62
  pass on the real code, in about a minute. Refactoring can now happen with
  evidence instead of hope.
- **Bonus, a CI debugging story:** the suite passed locally but failed on
  GitHub, and the raw logs weren't reachable. Made the pipeline report its
  own failures as PR annotations, which showed one browser crash cascading
  into 32 errors. Traced it to a specific Chromium build, and fixed it by
  making CI use the exact browser build used in development: reproducible
  environments over "works on my machine".
