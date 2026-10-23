# Maplenote: briefing for Claude

Maplenote is a small, self-hosted text editor that Charlie is building to
use daily and to learn from. It runs locally and, since 2026-10-23, on AWS
Lambda in workloads-prod behind CloudFront (see Architecture). Charlie knows some Python, is new to git and
GitHub, and wants to understand the architecture without reading every line.
Explain what you're doing and why, in plain language.

Start of a session: read `docs/ROADMAP.md` (what's done and what's next) and
`docs/DECISIONS.md` (what's been decided and why) before proposing work.

## Documenting is part of every task

The docs are for Charlie's future self, presentations, resume and job
interviews, and they're Claude's memory between sessions. Follow
`docs/DOCS-STANDARD.md` (shared with Charlie's other project repos). A task
isn't done until its docs are updated **in the same PR**:

1. **Journal:** add or extend `docs/journal/YYYY-MM-DD-<topic>.md` using the
   template in `docs/journal/README.md`.
2. **Decisions:** real choices go in `docs/DECISIONS.md` (newest at the
   bottom; correct old entries by marking them superseded).
3. **Roadmap:** tick off finished items; park side ideas; note limitations.
4. **Interview stories:** add or extend one in `docs/interview/README.md`
   when the work makes a good story.
5. **Runbooks:** repeatable procedures go in `docs/runbooks/`.
6. **Portfolio:** update `docs/PORTFOLIO.md` when the headline facts change.
7. **Changelog:** when a PR changes what someone using the app sees, add a
   new version at the top of `static/changelog.md` (rules: DECISIONS.md,
   2026-10-20, "A version number and changelog inside the app").

Never edit `docs/HISTORY.md` by hand; a workflow appends to it after each
merge. The `docs-check` workflow fails PRs that change code without touching
`docs/`. End every GitHub comment Claude posts with `— Claude` (comments
appear under Charlie's account).

## Architecture

- `app.py`: Flask server. Serves `static/` and a small JSON API over one
  workspace folder. The API is documented in its module docstring.
- `storage.py`: where files live. `app.py` never touches files directly; it
  calls one storage backend: `LocalStorage` (a folder, the default) or
  `S3Storage` (an S3 bucket, `MAPLENOTE_STORAGE=s3`). Both raise the same
  exceptions, which `app.py` turns into HTTP statuses. S3 saves use
  conditional writes (If-Match / If-None-Match) for the 409 conflict rule;
  its tests run against a fake S3 (moto), never real AWS.
- `config.py`: every setting, each overridable by a `MAPLENOTE_*` env var.
- `auth.py`: one password (checked against an scrypt hash in
  `MAPLENOTE_PASSWORD_HASH`) in front of the API when hosted; off locally.
  A sign-in page (`/login`, `static/login.html`) sets a signed session
  cookie; HTTP Basic also works for scripts. `/logout` signs out.
  The page and `/static/` are open (guest mode); the API is not.
  On Lambda the app refuses to start without the hash. Cognito replaces it later.
- `Dockerfile`: the one image for Lambda and anywhere else (gunicorn, one
  worker, plus AWS's Lambda Web Adapter). `deploy-prod` ships it plus the
  page's files to workloads-prod, after Charlie approves it in the
  `production` GitHub environment (`docs/runbooks/deploy.md`); the AWS
  resources are Terraform in the `cloud-homelab` repo (`terraform/prod/`).
  Sandbox keeps only a bucket for `aws-sandbox-check`; a dev copy is
  planned.
- `static/`: plain HTML/CSS/JS, no build step. `app.js` holds tabs, sidebar
  and file actions. Two modes: signed in (or local), and **guest** (not
  signed in: notes in the browser's IndexedDB, the API never called; the
  server's `maplenote_signed_in` cookie tells the page which). Notes go
  through `notes`: `serverNotes` (the API) or `browserNotes` (IndexedDB,
  repeating the server's rules). A tab's `kind` says where its file lives:
  `workspace` (via the server API), `guest` (a guest's note), `device`
  (opened with "Open…", read and saved by the
  browser directly; the server never sees it) or `copy` (fallback).
  A guest's first visit opens `static/welcome.md`; "Download all" zips a
  guest's notes in the page (`makeZip()`, no library). When hosted, "Sign
  out" saves, then clears this browser's drafts, handles and tab list.
  Shortcuts (Ctrl+S, Alt+W, Ctrl+E) are one keydown listener in `app.js`.
  The version is the first heading of `static/changelog.md`; the About box
  (the version in the status bar) shows it, the changelog, and the build
  record `static/build.json` that the `Dockerfile` writes into the image
  (commit and time, passed by `deploy-prod`).
  Every save goes through `saveTab()`; each tab tracks the file `version`
  it last saw, and saves carry it so changes made elsewhere aren't
  overwritten (the server returns 409 for workspace files).
  The editing area is CodeMirror 6 (`static/vendor/codemirror.js`, global
  `CM`): one editor view, and each tab has its own editor state.
  Markdown tabs have an Edit/Preview `mode`; the preview uses markdown-it
  (`static/vendor/markdown-it.js`, global `MD`) with `html: false`.
- Security headers (Content-Security-Policy etc.) are set in `app.py`;
  keep scripts and styles same-origin (no inline scripts, no CDNs). In
  workloads-prod the page comes from S3 through CloudFront, so CloudFront's
  response-headers policy must carry the same headers (`cloud-homelab`).
- Behind CloudFront (prod) every non-GET request needs an
  `x-amz-content-sha256` header (OAC): `static/body-hash.js`, used by
  `api()` in `app.js` and by `static/login.js` (the sign-in form is sent by
  script for this). The "signed in" hint cookie is set at sign-in as well
  as with the page, since in prod the server never serves the page.

## Ground rules

- The repo is public (since 2026-10-23; `docs/runbooks/go-public.md`), and so
  are its Actions logs. Anything holding the account ID goes in a
  **secret**, never a variable or a `run:` line, and nothing private goes
  in code, commits, PRs or comments.

- The server never reads or writes outside the workspace folder. Every path
  from the browser goes through `resolve_in_workspace()`.
- Enforce rules on the server, not just in the UI (e.g. the scratch pad is
  protected in both).
- Design for future cloud hosting: config via env vars, no assumptions that
  the server and the user's files share a machine. Nothing that reads or
  writes server-side files goes on the public internet without a login.
  The planned guest mode (no login) keeps notes only in the visitor's
  browser and never calls the files API (see DECISIONS.md, 2026-10-20).
- Keep it simple and dependency-light. Vendor frontend libraries into
  `static/vendor/`; no CDNs (it must work offline). Bundles are built from
  `vendor-src/` (see its README); rebuild only when upgrading, prefer
  releases a few weeks old, and commit the recipe and bundles together.
- Must run on Python 3.11 (Charlie's Chromebook) and in current Chrome.

## How we work

- Work on a branch and open a pull request; Charlie reviews and merges.
- Each PR updates its docs (see "Documenting is part of every task" above)
  and fills in the PR template's checklist.
- Every change comes with tests: extend `tests/test_api.py` for the server
  and `tests/browser/` for behaviour in the page (helpers in
  `tests/browser/helpers.py`). Run `python -m pytest` before pushing; the
  `tests` workflow runs it on every PR and must pass.
- Playwright is pinned to 1.56, whose Chromium (build 1194) is the one
  preinstalled in cloud sessions, so `python -m pytest` uses the same browser
  locally and in CI. Don't upgrade it without checking CI (see DECISIONS.md).
  If a failure only happens on GitHub, the `tests` check's annotations hold
  the first failure in full (the raw logs aren't reachable from a session).
- Prove a new test can fail: break the code it protects, watch it fail,
  restore.

## Running it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
MAPLENOTE_WORKSPACE=/tmp/ws python app.py   # http://localhost:8000
```
