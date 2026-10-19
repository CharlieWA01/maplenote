# Decisions

Why Maplenote is built the way it is. Newest at the bottom. Each entry: what
was decided, what else was considered, the trade-offs, and why. A decision
that changes later gets marked superseded, not deleted, so nobody (human or
Claude) re-argues a settled question or undoes something without knowing why
it was there. Format: see `docs/DOCS-STANDARD.md`.

## 2026-10-17: Python + Flask local web app
**Decision:** A Python (Flask) server plus a plain HTML/CSS/JS page, used in
the browser at `localhost:8000`.
**Why:** Charlie mostly uses a Chromebook and wants it OS-agnostic. Python
runs everywhere (Chromebook via its Linux environment), the browser is the UI,
and it moves to the cloud naturally. Flask is small and readable; one
dependency.
**Rejected:** Desktop app (platform-specific), terminal editor, FastAPI (more
concepts than needed), Python's built-in `http.server` (more boilerplate).
**Also:** dark theme by default; no build step for the frontend.

## 2026-10-17: Safety foundations
- **One workspace folder.** Every path is resolved and must stay inside it;
  `../` tricks and symlinks pointing outside are refused.
- **Host header allowlist** (`ALLOWED_HOSTS`) blocks DNS-rebinding attacks,
  where a malicious website gets your browser to talk to a local server.
- **Atomic saves:** write a temp file, then swap it in, so a crash mid-save
  never leaves a half-written file.
- **Binds to 127.0.0.1 by default:** reachable only from the same machine.

## 2026-10-17: Files over 10 MB refused
**Decision:** The server refuses files over `MAX_FILE_BYTES` (10 MB).
**Why:** Browsers and editors bog down on very large files. Supporting them
needs a different design (load in chunks, render only the visible part). A
read-only log viewer is parked as the better answer for big logs.

## 2026-10-17: Markdown preview as a toggle, `.md` only
**Decision:** An Edit/Preview toggle that appears only on `.md` tabs, not a
side-by-side split.

## 2026-10-17: CodeMirror for the editing area
**Decision:** Replace the plain `<textarea>` with CodeMirror in step 4,
bundled into `static/vendor/` (no CDN). No syntax highlighting in v1.
**Why:** Undo/redo, find & replace, and line numbers are fiddly and fragile on
a textarea (e.g. programmatic replace breaks Ctrl+Z). CodeMirror is mature
and modular, so syntax highlighting is an easy later add-on.
**Rejected:** Monaco (VS Code's editor): heavier than needed.
*Version question settled 2026-10-18: CodeMirror 6 (see "CodeMirror 6, bundled once and committed" below).*

## 2026-10-17: Autosave, no "unsaved changes" prompts
*Partly superseded (2026-10-18): prompts now appear when autosave is off; see "Unsaved-changes warnings when autosave is off" below.*
**Decision:** Step 3 adds autosave about 1 s after typing stops, plus crash
recovery from drafts kept in the browser. No "are you sure?" prompts for
unsaved work. Deleting a file still asks for confirmation (it can't be undone).

## 2026-10-17: Open tabs remembered per browser
**Decision:** The list of open tabs is stored in the browser's localStorage.
**Why:** Simple, and a per-device tab layout makes sense. File contents are
always loaded fresh from the server.

## 2026-10-17: Scratch pad protected by the server
**Decision:** `scratch.txt` is always open in the first tab and can't be
closed, renamed or deleted. The server refuses rename/delete too, not just
the UI.
**Why:** Rules enforced only in the browser can be bypassed. General
principle: enforce rules on the server.

## 2026-10-17: The repo is the source of truth
**Decision:** Plans and decisions live in `CLAUDE.md`, `docs/ROADMAP.md` and
this file, not in chat history.
**Why:** Claude doesn't remember past sessions; the repo does.

## 2026-10-17: Work through branches and pull requests
**Decision:** Claude works on a branch and opens a PR; Charlie reviews and
merges. Each PR updates the roadmap and this log as needed.
**Why:** `main` only changes when Charlie approves, and the PR history records
what changed and why. Steps 1 and 2 predate this and were committed to `main`.

## 2026-10-17: Designed with cloud hosting in mind
**Decision:** Keep the app ready to containerize and host (e.g. AWS) later,
without building for it yet.
**Consequences:** Settings come from env vars. Step 3 includes edit-conflict
detection (two devices autosaving the same file). Disk access will move behind
a storage layer before hosting. **No public deployment without a login.**

## 2026-10-17: Local files open through the browser, not the server (PR #2)
**Decision:** An "Open…" button uses Chrome's File System Access API to open
`.txt`/`.md` files anywhere on the user's device and save back to them.
**Why:** On a Chromebook the Linux server can't see Downloads or Google Drive
unless they're shared; the browser can. More importantly, once Maplenote is
hosted in the cloud, "server folders" would be on the server, not the user's
device, while the browser picker still opens the user's own files.
**Rejected:** Extra server-side workspace folders ("Option B"); parked.
**Trade-offs:** Edit-in-place works in Chrome/Edge only (other browsers fall
back to downloading a copy). Requires a secure origin: `localhost` works,
`penguin.linux.test` doesn't. After a refresh, Chrome asks once to re-allow
access to each file.
**How it's built:** Tabs have a `kind`: `workspace` (server API),
`device` (browser file handle) or `copy` (fallback; Save downloads a copy).
Device file handles are kept in IndexedDB so those tabs survive a refresh;
if Chrome has forgotten the permission, the tab shows an "Allow access"
button, which asks for read and write together so there's one prompt.
Device files get the same rules as the server: 10 MB limit (the server
reports it in `/api/files`) and must be valid UTF-8. Copy tabs aren't
restored after a refresh.

## 2026-10-18: Autosave, crash recovery and conflict detection (PR #3)
**Decision:**
- **Autosave** about 1 s after typing stops, **on by default** with a toolbar
  toggle (remembered per browser). The Save button stays either way.
- **Crash recovery:** while you type, a draft of each tab is kept in the
  browser's IndexedDB. If a save never happened (server stopped, crash, or
  autosave off and the page closed), reopening offers "Keep them / Discard".
- **Conflict detection:** each tab remembers the *version* of the file it
  loaded. Workspace versions are a fingerprint (hash) of the contents,
  computed by the server, which **refuses** a save whose `base_version` is
  out of date (409). Device files use their last-modified time, checked by
  the browser. On a conflict, a banner offers **Load their version / Keep
  mine / Save mine as a copy** (copy for workspace files only).
- **Quiet reload:** if a file changed elsewhere and this tab has no unsaved
  edits, it just reloads when you switch to it or return to the window.
**Why:** No lost work, and no silent overwrites, which matter most once
Maplenote is used from several devices against one server.
**Details:** All saving goes through `saveTab()` in `app.js`. A recovered
draft keeps the version it was made against, so restoring it after the file
changed raises a conflict instead of overwriting. Copy tabs never autosave
(each save would be a download). Closing a tab saves it first when autosave
is on; see the next entry for when it's off.
**Rejected:** Per-file autosave settings (parked); automatic merging of
conflicting edits (complex, and a wrong merge is worse than asking).

## 2026-10-18: Unsaved-changes warnings when autosave is off (PR #3 review)
**Decision:** When a tab's edits won't be autosaved (autosave off, or a copy
tab), closing it asks **"Save changes to X before closing?"** with
**Save / Don't save / Cancel** (Maplenote's own dialog; the browser's
`confirm()` only offers OK/Cancel). Closing or refreshing the browser tab
in that state shows Chrome's standard "Leave site?" warning (pages can't
change its wording). With autosave on, there are still no prompts: closing
saves first.
**Why:** Charlie, reviewing PR #3: silently discarding edits goes against
normal editor practice. The original "no alerts" choice assumed autosave
was always on; once it became optional, the "off" case needed the
familiar safety net.
**Supersedes:** part of the 2026-10-17 entry "Autosave, no \"unsaved changes\" prompts".

## 2026-10-18: CodeMirror 6, bundled once and committed (PR #4)
**Decision:** Use CodeMirror **6**. The pieces we use are bundled with esbuild
into one file, `static/vendor/codemirror.js` (a global `CM`), which is
committed. The recipe (exact pinned versions, entry file, build command)
lives in `vendor-src/`; license texts in `static/vendor/THIRD-PARTY-LICENSES.txt`.
**Why 6 over 5:** 5 is in maintenance mode; 6 is current, better on touch
screens (Chromebook), and is what Obsidian uses. Its one downside, needing a
bundling step, only applies when *upgrading* the library: running Maplenote
still needs just Python, and works offline.
**How it's used:** one `EditorView` on screen; each tab owns an
`EditorState` (text, cursor, undo history, find bar), swapped in on tab
switch, so undo survives switching tabs. A tab is "dirty" when its document
differs from `savedDoc`, so undoing back to the saved text makes it clean.
Included: line numbers, history, find & replace (Ctrl+F, plus a Find
button), highlight matches, word wrap (toggle in the status bar, **on by
default**, remembered per browser), Tab inserts a tab. Status bar shows
line/column, selection size, word and line counts.
**Checked:** an 8 MB, 120,000-line log opens in ~0.2 s and stays responsive.

## 2026-10-18: Markdown preview with markdown-it, plus a Content-Security-Policy (PR #5)
**Decision:** `.md` / `.markdown` tabs get an **Edit | Preview** switch at
the right of the tab row (Obsidian's spot). Preview is rendered with
**markdown-it**, vendored like CodeMirror (`static/vendor/markdown-it.js`,
global `MD`, pinned to 15.0.2). Each tab remembers its mode, and preview
modes are restored after a refresh.
**Rendering choices:** `html: false` (HTML in a file is shown as text,
never run), `linkify: true`, `breaks: true` (a single line break is a line
break, as in Obsidian). `- [ ]` / `- [x]` become read-only checkboxes.
Web and email links open in a new browser tab; other links do nothing yet.
**Security:** the preview turns file contents into HTML, and files can come
from anywhere (e.g. Downloads), so besides `html: false` the server now
sends a **Content-Security-Policy** on every response: scripts only from
this server, no plugins, no framing; images from anywhere. A test file full
of injection attempts (`<script>`, `onerror`, `javascript:` links) renders
as harmless text.
**Rejected:** `marked` + DOMPurify (two libraries where one suffices);
side-by-side split view (decided earlier: a toggle).
**Pinned versions:** the newest markdown-it release was two days old, so we
took the newest one that had been out for a few weeks.

## 2026-10-19: A shared documentation standard, mostly automated
**Decision:** Adopt the practice started in the `cloud-homelab` repo as a
written standard (`docs/DOCS-STANDARD.md`, identical in every project repo):
portfolio summary, roadmap, decision log, dated journal entries with an
"In my own words" section for Charlie, STAR interview stories, runbooks, and
an automatic history of merged PRs. Backfilled Maplenote's journal, stories
and history from the first two days while the details were fresh, and
reformatted this decision log to the shared format (oldest first).
**Automation:** `CLAUDE.md` makes documenting part of every task; a PR
template carries the checklist; the `docs-check` workflow fails PRs that
change code without touching `docs/` (label `no-docs-needed` for
exceptions); the `docs-history` workflow appends each merged PR to
`docs/HISTORY.md`.
**Alternatives:** a separate docs repo or a document tool (drifts from the
code, not versioned with it); generating everything from commit messages
(captures *what* but not *why*); an AI summary after the fact (loses detail;
the point is to write it while it's fresh); a weekly scheduled Claude review
for gaps (Charlie: not needed; the workflows and `CLAUDE.md` cover it).
**Why:** Charlie wants a record to use for presentations, a resume and
interviews, and Claude has no memory between sessions. Writing docs in the
same PR as the change keeps them true; the workflows catch what the habit
misses. "In my own words" stays manual on purpose: it's what makes the
record Charlie's own.
**Trade-offs:** the history workflow commits to `main` after each merge, so
`git pull` after merging brings down one extra commit. The standard is
copied between repos, so it has to be kept in sync by hand for now.

## 2026-10-19: Host on AWS as a Docker image running on Lambda
**Decision:** Package Maplenote as a Docker image (Flask + gunicorn + AWS's
Lambda Web Adapter) and run it on **AWS Lambda**, with files in **S3** and
login through **Cognito**. The same image runs locally, on the planned
Proxmox homelab, or on an always-on container service later if needed.
**Alternatives:**
- *Always-on container* (ECS Fargate, App Runner, EC2): Flask unchanged, no
  cold starts or payload limits, room for live sync. But it bills around the
  clock: roughly $9/month for the smallest Fargate task plus about $3.60 for a
  public IPv4 address or $16+ for a load balancer, against a $10/month budget
  and `cloud-homelab`'s "serverless first, ask before hourly costs" rule.
- *Plain Lambda from a zip file* with a WSGI adapter: cheapest and simplest,
  but no Docker practice and less portable.
**Why:** serverless pricing (cents a month for one user) with container
portability and Docker practice; almost no Flask changes; a ready exit path to
Fargate or the homelab if Lambda's limits ever bite.
**Trade-offs:** Lambda requests and responses are limited to about 6 MB, so
the cloud file limit becomes 5 MB (configurable; 10 MB stays locally).
Occasional cold starts (up to a second or two after idle). No long-lived
connections, so live sync between devices would need a rethink. The image is
stored in ECR (cents a month). Prices quoted are approximate, to be checked
when the infrastructure is designed.
**Open for Phase 3:** API Gateway vs. a Lambda function URL in front;
whether Maplenote's Terraform lives in this repo or in `cloud-homelab`.
**Reconfirmed (2026-10-19):** after weighing a plain zip again (simpler first
deploy, fewer AWS pieces), Charlie kept the Docker image, so the same image can
run on the homelab later.
**Supersedes:** the earlier roadmap items "Production web server (gunicorn)
instead of Flask's dev server" and "Deploy to AWS or a simpler host; pick based
on cost" (gunicorn stays, inside the image).

## 2026-10-19: Automated tests in Python, run on every PR
**Decision:** A test suite in the repo: `tests/test_api.py` (pytest with
Flask's test client) for the server, and `tests/browser/` (Playwright for
Python, through pytest-playwright) for real scenarios in Chromium. A `tests`
GitHub Actions workflow runs everything on every PR and push to `main`, on
Python 3.11 like the Chromebook, keeping a Playwright trace of any failed
browser test. Pinned: pytest 9.1.1, pytest-playwright 0.9.0, and
**Playwright 1.56.0** (see below). GitHub runs the full Chromium in headless
mode (`--browser-channel chromium`), closer to real Chrome than Playwright's
stripped-down "headless shell".
**Alternatives:** keep testing with throwaway scripts (what we did before:
nothing survived a session, and nothing ran on PRs); Playwright for
Node/JavaScript (the same tool, but the project and Charlie are Python).
**Why:** the storage layer is about to change how every file is read and
saved; this suite is the safety net that proves the behaviour stays the
same. Python keeps the tests readable for Charlie.
**How we know the tests work:** three protections were deliberately broken
(the server's conflict check, the preview's HTML switch, the workspace path
check); each time, the relevant tests failed (5, 1 and 6 tests), and the
code was restored.
**Why Playwright 1.56, not the newer 1.63:** with 1.63's Chromium, GitHub's
browser crashed in one test, restoring a test-only file handle (from the
browser's private storage) after a page reload, and took every later browser
test down with it. It happened in both headless modes, never with Chromium
141. Charlie's real Chrome restores real device files after a refresh, so
this points at that Chromium build plus test-only handles, not at
Maplenote. Pinning 1.56 makes CI use Chromium 141, the exact build
preinstalled in Claude's cloud sessions, so a pass in a session means a pass
on GitHub. Retrying a newer version is parked.
**Trade-offs:** about a minute per CI run; browser tests use fixed waits in
a few places where autosave timing matters; the test tool is a year old (it
only affects testing, never the app). Device-file tests replace only
the native file picker (it can't be clicked by a test) with real file
handles from the browser's private storage.

## 2026-10-19: A storage layer with local and S3 backends, tested against a fake S3
**Decision:** All file access moves out of `app.py` into `storage.py`, behind
one small interface (list, read, version, write, create, delete, rename) with
two backends: `LocalStorage` (the workspace folder, the default) and
`S3Storage` (an S3 bucket, optionally under a prefix), chosen with
`MAPLENOTE_STORAGE`. Backends report problems as shared exceptions
(`NotFound`, `Conflict`, …) that `app.py` maps to HTTP statuses, so the API
code is identical for both.
- **Conflict detection on S3** uses S3's conditional writes: a save checks the
  stored version, then writes with `If-Match: <ETag>` (or `If-None-Match: *`
  for a file that doesn't exist yet). S3 itself refuses the write with 412 if
  anything changed in between, which Maplenote reports as the usual 409.
  This matters on Lambda, where two saves can run on different machines and
  an in-memory lock (what `LocalStorage` uses) can't help.
- **Versions stay content fingerprints** (SHA-256), as before. S3Storage also
  stores the version in the object's metadata, so checking for changes (the
  page's `/api/stat` calls) reads only the object's headers. Objects uploaded
  some other way have no stored version; their contents are hashed instead.
- **boto3 is imported only when S3 is used**, so running locally needs no new
  packages. boto3 and moto are in `requirements-dev.txt` for the tests; adding
  boto3 to the deployed package is part of the packaging step.

**Alternatives:**
- *Use S3's ETag as the version:* fewer reads, but the version would differ
  between backends and change meaning if files were ever uploaded in parts.
- *Test the S3 backend against a real bucket:* the truest test, but needs AWS
  credentials in CI and costs money; moto (pinned 5.2.3) answers boto3's calls
  in memory, including conditional writes. Real S3 gets checked once, when the
  sandbox bucket exists.
- *Mount S3 as a folder (s3fs, Mountpoint):* no code changes, but no
  conditional writes, and not available on Lambda.

**Why:** the next steps (Lambda, Cognito) need files in S3, and the existing
safety rules (stay inside the workspace, never overwrite unseen changes) must
hold there too. One interface keeps the API code and its 27 tests unchanged.
**Trade-offs:** S3 has no rename, so rename is copy then delete (see Known
limitations). Each S3 save makes two requests (check, then write); reads make
one. At one user's scale that's a fraction of a cent a month.

## 2026-10-19: Check the S3 backend against the real sandbox bucket, from main only
**Decision:** a separate workflow, `aws-sandbox-check`, signs in to the AWS
sandbox account through the GitHub deploy role (OIDC, no stored keys) and
runs `tests/test_real_s3.py` against Maplenote's real bucket, in a
`ci-check/<run>/` folder it empties afterwards. It runs when a change to
`storage.py`, that test file or the workflow reaches `main`, and on demand
from the Actions tab. Everywhere else the real-S3 tests are skipped.
**Alternatives:** run it on pull requests (the deploy role trusts only
`main`, deliberately, so a PR can't reach AWS); a second AWS role trusted by
PRs (more to secure for little gain at this stage); keep only the moto
tests (moto imitates S3 well, but it doesn't enforce encryption settings
or IAM: two of the four real-S3 tests fail against moto, which is how we
know they test something moto can't).
**Why:** closes the "real S3 gets checked once the sandbox bucket exists"
item from the storage-layer decision, and proves the sign-in path the
future deploy workflow will use. **Trade-off:** a problem with real S3
shows up after merge, not before. **Cost:** under a cent per run.

## 2026-10-19: The Docker image: slim Python, gunicorn, AWS's Lambda Web Adapter
**Decision:** one `Dockerfile` for every place Maplenote runs: the official
`python:3.11-slim` image, the app's packages plus gunicorn and boto3
(`requirements-image.txt`), and AWS's **Lambda Web Adapter** (1.1.0) copied
into `/opt/extensions`. On Lambda the adapter turns Lambda's events into
ordinary HTTP requests to gunicorn; anywhere else it never starts, and the
same image serves the browser directly (`docker run -p 8000:8080 -v
~/maplenote-files:/data maplenote`). gunicorn runs **one worker process**
with 4 threads, as user 1000 (not root), with nothing written outside
`/tmp` and `/data`. The image is built for **x86_64**, and each one is
tagged with its git commit in an ECR repository whose tags can't be
reused.
- A `deploy-sandbox` workflow builds and pushes the image after each merge
  that changes the app, points the Lambda function at it, then checks from
  outside that the URL answers 401 (asks for the password). A 200 fails the
  deploy, since it would mean the notes are open.
- The `tests` workflow gains an `image` job: every PR builds the image and
  runs it the way Lambda does (read-only disk, non-root), with and without
  a password.

**Alternatives:**
- *AWS's own Lambda base image* (`public.ecr.aws/lambda/python`) with a
  handler (Mangum/awsgi-style): no adapter, but the image would only run on
  Lambda, losing the "same image on the homelab" point of the hosting
  decision.
- *Several gunicorn workers:* more parallel requests locally, but the
  local-folder storage guards saves with a lock that only works inside one
  process. Threads keep the lock valid.
- *arm64 (Graviton):* about 20% cheaper per second on Lambda (fractions of
  a cent here), but GitHub's standard runners would have to emulate ARM,
  making builds several times slower.
- *A mutable `latest` tag:* simpler, but "which code is running?" would
  have no reliable answer, and a rollback couldn't name a version.

**Why:** the hosting decision (Docker on Lambda, portable to Proxmox) with
the fewest moving parts: a standard base image, one small AWS program, and
the same gunicorn command everywhere.
**Trade-offs:** the image is about 250 MB (boto3 is most of it; ~80 MB
compressed in ECR, cents a month for the 5 kept). Cold starts after idle
take a second or two. The adapter comes from AWS's public registry, pinned
by version.

## 2026-10-19: A password in front of the hosted app until Cognito login exists
**Decision:** when `MAPLENOTE_PASSWORD_HASH` is set, every request (the
page, its scripts and the API) needs one password, sent with HTTP Basic
authentication: the browser shows its own sign-in box and remembers the
answer until it's closed. The server holds only a **scrypt hash** of the
password (`python auth.py` makes one), so neither AWS, Terraform state nor
logs ever see the password. The username is ignored. On Lambda, Maplenote
**refuses to start without a hash**, so a missing setting fails closed
instead of putting the notes online open. Locally nothing changes.
**Alternatives:**
- *AWS-signed requests only* (function URL with IAM auth): nothing new to
  build, but a browser can't open the URL, only `curl` with AWS
  credentials, so there'd be nothing to click until Cognito.
- *No protection, URL kept secret:* breaks the project's rule that nothing
  goes on the public internet without a login, and the URL would read and
  write the real bucket.
- *Cognito now:* the real answer, but a step of its own (user pool, hosted
  sign-in page, token checks); planned next.

**Why:** keeps the rule, gives a URL Charlie can open in Chrome today, and
is about 40 lines that Cognito replaces later.
**Trade-offs:** one shared password, no sign-out button (close the browser),
and no lockout after wrong guesses. With a long random password guessing
is hopeless, and the function's reserved concurrency (2) caps how fast
anyone can try and what it can cost. Checking a password is deliberately
slow, so the last accepted header is remembered and repeat requests skip
the check.

## 2026-10-19: A sign-in page instead of the browser's sign-in box
**Decision:** the stopgap password (previous entry) is now entered on a
small sign-in page, `/login`, a plain HTML form with no script. A right
password gets a session cookie: the time it was issued plus an HMAC-SHA256
signature keyed with the password hash, `HttpOnly`, `Secure`,
`SameSite=Lax`, valid 30 days. Signed out, the page redirects to `/login`
and other requests get a 401, which sends an open page back to `/login`.
`/logout` signs out. HTTP Basic still works for scripts (`curl -u`), but
the reply no longer carries the `WWW-Authenticate` header.
**Supersedes:** the "sent with HTTP Basic authentication" part of the
entry above; the hash, the fail-closed start-up check and everything else
stand.
**Why:** on the live Lambda URL Chrome showed only the 401's JSON error,
never its sign-in box. The box appears only when the reply carries a
`WWW-Authenticate` header, so the function URL evidently doesn't pass it
through (inferred from the symptom: the password check itself worked).
A form works the same everywhere, adds a way to sign out, and is the shape
the Cognito login will take (a page, then a cookie).
**Alternatives:** credentials in the address (`https://user:pass@…`):
Chrome restricts them and they'd end up in history; API Gateway in front
to pass the header through (a new resource for a stopgap); server-side
sessions (needs storage; a signed cookie needs none).
**Trade-offs:** about 60 more lines than Basic. A copied cookie works for
up to 30 days on another machine, until the password changes. No
per-device sign-out yet.
