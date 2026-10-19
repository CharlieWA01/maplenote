# 2026-10-19: An automated test suite, run on every PR

## Goal
Replace throwaway test scripts with a lasting test suite in the repo, run by
GitHub Actions on every pull request, before the storage-layer refactor.

## What was done
- `tests/test_api.py`: 27 tests of the JSON API with Flask's test client:
  listing, reading, saving and versions, the 409 conflict rule, create /
  rename / delete, scratch-pad protection, path escapes (`../`, absolute
  paths, symlinks, encoded dots), forged `Host` headers, size and binary
  limits, security headers.
- `tests/browser/`: 35 tests driving Chromium with Playwright for Python:
  - `test_editing.py`: tabs, sidebar, autosave, refresh, undo across tabs,
    new / rename / delete, find & replace, status bar, word wrap.
  - `test_saving.py`: the two-tab conflict and all three choices, quiet
    reload, crash recovery (keep, discard, stale draft), the
    Save / Don't save / Cancel dialog, the leave-page warning.
  - `test_device_files.py`: open, autosave, refresh, conflicts, the
    one-click permission, the download fallback.
  - `test_markdown.py`: rendering, malicious Markdown, links, remembered
    mode.
- `tests/conftest.py`: an empty workspace per test, the app running in a
  background thread, a fresh browser profile per test.
- `.github/workflows/tests.yml`: Python 3.11, installs Chromium, runs
  `pytest`, keeps traces of failed browser tests.
- `requirements-dev.txt`, `pytest.ini`; README, runbook and `CLAUDE.md`
  explain how to run them.

## Problems and fixes
- **All device-file tests errored at setup.** A fixture named `device`
  clashed with pytest-playwright's own `device` fixture (for emulating
  phones). Renamed to `open_device_file`.
- **One Markdown test expected one line break;** the paragraph had three
  lines, so two breaks was correct. The test was wrong, not the app.
- **The suite failed on GitHub but passed locally.** Getting there:
  - The raw logs can't be downloaded from Claude's session (GitHub serves
    them from storage the session's network blocks). So the workflow now
    turns failures into PR annotations, which can be read: the summary, the
    first real failure in full, and the failing test names. It skips
    "errors" that are knock-on effects, since GitHub shows only 10
    annotations per step.
  - Found a genuine race: the device-file refresh test could reload before
    the file was remembered. Fixed by waiting for the tab first. Gave the
    crash-recovery tests more time to store their draft (2 s).
  - The real cause: **the browser itself crashed** in the device-file refresh
    test, then every later browser test failed for lack of a browser
    (1 failed, 32 errors). It was the same in Playwright's headless shell and
    in full Chromium, and only with Playwright 1.63's newer Chromium. Pinned
    Playwright 1.56, whose Chromium 141 is the build preinstalled in Claude's
    sessions. CI went green, and local and CI runs now use the identical
    browser. Charlie's real Chrome restores real device files after a
    refresh, so this looks like a Chromium issue with test-only file handles,
    not a Maplenote bug. Retrying newer versions is parked.
  - Updated `actions/checkout` and `setup-python` to v7 and `upload-artifact`
    to v6; the v4/v5 versions ran on a deprecated Node.js.

## How it was verified
- The full suite passed twice in a row (no flaky tests), in about 50 seconds.
- **Sabotage check:** disabling the server's conflict check made 5 tests
  fail; allowing raw HTML in the preview made 1 fail; removing the workspace
  path check made 6 fail. Each time the code was restored from git.
- The `tests` workflow passes on GitHub (Python 3.11, full headless
  Chromium 141).

## Impact
Every future PR is checked automatically, in both the API and a real
browser. The storage layer can now be built with a safety net.
