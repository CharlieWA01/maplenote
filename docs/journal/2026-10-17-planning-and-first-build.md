# 2026-10-17: Planning and the first build

*Backfilled on 2026-10-19 from the working session, while it was still fresh.*

## Goal
Decide what kind of text editor to build, set up GitHub and the Chromebook
for development, and get a first working version running.

## What was done

**Requirements, by being "grilled" first.** Before any code, Claude asked
questions in seven areas: what "locally hosted" means, who it's for, how files
are handled, which features matter, learning vs. using, technical background,
and security. The answers shaped everything after:

- A **local web app**: a Python server on the machine, used in a browser tab.
  OS-agnostic, works on a Chromebook (Linux environment), and could move to
  the cloud later.
- **Notepad++-style**, with Obsidian as the other inspiration: tabs, autosave,
  dark theme, undo/redo, find & replace, line numbers, word wrap, word count,
  Markdown preview. No syntax highlighting or spell check for now.
- **Learning project as well as a tool**: build a solid base, add components
  later, understand the architecture without reading every line.
- **Localhost for now, but designed to be hostable later.**

Claude proposed the architecture (Flask server with a tiny JSON API over one
workspace folder, plain HTML/JS in the browser, CodeMirror planned for the
editing area) and a six-step build order where every step leaves something
that runs. Decisions are in `docs/DECISIONS.md`, dated 2026-10-17.

**Setting up GitHub and the Chromebook (first time using either for real):**
1. Created the GitHub repo `maplenote` and connected GitHub to Claude.
2. Turned on the Chromebook's Linux environment; installed `git` and
   `python3-venv`.
3. Installed the GitHub CLI (`gh`) and logged in with `gh auth login`, so git
   can reach the private repo; set `user.name` / `user.email`.
4. First `git clone`. First `git pull` once step 1 was pushed.

**Step 1 (commit `741a8b9`):** the Flask server and a bare editor page: list,
read and save files in `~/maplenote-files`. Built with safety from the start:
every path is confined to the workspace (no `../` or symlink escapes), unknown
`Host` headers are refused (DNS-rebinding protection), files over 10 MB are
refused, saves are atomic.

**Step 2 (commit `4c61fbf`):** a file sidebar with collapsible folders, tabs
with an unsaved-changes dot, a pinned `scratch.txt` that can't be closed,
renamed or deleted (enforced by the server, not just the page), new / rename /
delete, and open tabs restored after a refresh.

Both steps were committed straight to `main`; pull requests started the same
evening (see the next journal entry).

## Problems and fixes
- **The new repo wasn't visible to Claude.** The Claude GitHub App had been
  given access to selected repositories only, and a repo created afterwards
  isn't added automatically. Fixed in GitHub settings → Applications → Claude
  → Repository access.
- **`apt` lock error** on the first install: the new Linux environment was
  running its own updates in the background. Fix: wait for it to finish (and
  don't delete the lock file). A stray `~` at the end of the command would
  also have failed.
- **Private repo needs authentication to clone.** Solved with `gh auth login`
  (browser-based login), which also configures git.

## How it was verified
- Claude tested the API with `curl`: path traversal (`../../etc/passwd`),
  absolute paths, a symlink pointing outside, a binary file, a missing file,
  bad JSON and a forged `Host` header were all refused with clear errors.
- The page was driven in headless Chromium: open, edit, save, new file,
  rename, delete, folders collapsing, tabs restored after a refresh.
- Charlie ran it on the Chromebook at `localhost:8000`, created and saved
  files, and found it "working pretty good".

## Impact
A working local editor on day one, with the safety rules in place before any
features, and a development workflow (GitHub + Chromebook) that every later
step reused.

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_
