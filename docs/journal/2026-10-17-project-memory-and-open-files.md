# 2026-10-17: Project memory, first pull requests, opening device files

*Backfilled on 2026-10-19 from the working session.*

## Goal
Learn how git versioning and pull requests work, set up a written "source of
truth" for the project, and add a way to open files from anywhere on the
device.

## What was done

**Git fundamentals.** Walked through commits as snapshots, the three copies of
the history (GitHub, Claude's session, the Chromebook), `git log` / `git
show`, and the three ways back: `git checkout <commit>` to look,
`git revert` to undo safely, and `git reset --hard` (avoid). Noted that git
versions the code, not the notes in `~/maplenote-files`.

**A source of truth that outlives chat** ([PR #1][pr1], Charlie's first pull
request). Claude doesn't remember past sessions, so plans and reasoning moved
into the repo: `CLAUDE.md` (the briefing every session reads), `docs/ROADMAP.md`
(with a parking lot for side ideas) and `docs/DECISIONS.md`. Rule from then on:
every PR updates the docs it affects. Charlie reviewed it on GitHub, left a
first comment, merged, deleted the branch and pulled.

**"Open…" for device files** ([PR #2][pr2]). Charlie wanted to open `.txt`
and `.md` files from Downloads, Google Drive and USB. Two designs were
compared:
- *A:* the browser's file picker (File System Access API) reads and saves the
  file directly; the server never sees it.
- *B:* extra workspace folders on the server (requires sharing folders with
  the Linux environment).

Charlie raised a new constraint at this point: **the app should eventually be
containerized and hosted on AWS.** That settled it: with the server in the
cloud, "server folders" would be on the server, not the user's device, while
the browser picker still opens the user's own files. Option A was built; B
was parked. Tabs gained a `kind` (`workspace` / `device` / `copy`), device
file handles are kept in IndexedDB so tabs survive a refresh, and other
browsers fall back to "Save downloads a copy". The same discussion produced
the cloud-readiness roadmap (storage layer, Dockerfile, gunicorn, login,
HTTPS) and a decision to build edit-conflict detection early.

Charlie tested the branch on the Chromebook **before** merging, which was the
first time trying a PR locally (`git fetch` and `git switch <branch>`).

## Problems and fixes
- **Testing a native file picker automatically isn't possible.** Claude
  tested with real file handles from the browser's private storage instead,
  and asked Charlie to confirm the two parts only a person can click: Chrome's
  permission prompt and the "Allow access" panel after a refresh. Both
  confirmed on the Chromebook.
- **Saving back only works on a "secure" address:** `localhost:8000` works,
  `penguin.linux.test:8000` doesn't. Documented in the README.

## How it was verified
Headless Chromium: open, edit and save a device file; no duplicate tab when
reopening; binary and over-10 MB files refused; tabs restored after refresh;
the Allow-access flow; closing forgets the handle; the fallback path opens and
downloads a copy. All step 2 workspace features re-tested. Charlie confirmed
the real picker and permission prompts.

## Impact
Maplenote can edit any text file on the device, in a way that will keep
working once the server lives in the cloud. The project now has a written
memory and a review-before-merge workflow.

[pr1]: https://github.com/CharlieWA01/maplenote/pull/1
[pr2]: https://github.com/CharlieWA01/maplenote/pull/2
