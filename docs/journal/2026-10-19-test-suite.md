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
- **Cloud sessions have an older preinstalled Chromium** than Playwright
  1.63 expects. The tests can be pointed at any Chromium with
  `MAPLENOTE_TEST_CHROMIUM`; GitHub Actions installs the matching one.

## How it was verified
- The full suite passed twice in a row (no flaky tests), in about 50 seconds.
- **Sabotage check:** disabling the server's conflict check made 5 tests
  fail; allowing raw HTML in the preview made 1 fail; removing the workspace
  path check made 6 fail. Each time the code was restored from git.
- The `tests` workflow runs for real on this PR.

## Impact
Every future PR is checked automatically, in both the API and a real
browser. The storage layer can now be built with a safety net.

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_
