# Roadmap

Status: ✅ done · 🚧 in progress · ⏭️ next · ⬜ planned

## Version 1: a simple, Notepad++-style editor

| # | Step | Status |
|---|------|--------|
| 1 | Flask server + bare editor: open, edit, save one file | ✅ |
| 2 | File sidebar, tabs, pinned scratch pad, tabs restored on refresh | ✅ |
| 2b | **"Open…" button for local files** (Downloads, Google Drive, USB) via the browser's file picker; saves write back to the original file | ✅ |
| 3 | Autosave (~1 s after typing stops), crash recovery (drafts kept in the browser), edit-conflict detection; autosave can be switched off | ✅ |
| 4 | Switch to CodeMirror: undo/redo that survives tab switches, find & replace, line numbers, word-wrap toggle, word/line count | ✅ |
| 5 | Markdown preview: Edit/Preview toggle, `.md` files only | ✅ |
| 6 | Polish: a sign-out button, keyboard shortcuts (Ctrl+S, Alt+W, Ctrl+E), a guest's "Download all" (.zip), an icon, README | ✅ 2026-10-22 |
| 6a | **Version number and changelog in the app:** an About box from the status bar shows the version, the build's commit and the changelog (`static/changelog.md`); finishing Version 1 made it 1.0.0 (2026-10-22) | ✅ |

## Cloud-ready (local work, no AWS needed)

Target: a Docker image that runs on AWS Lambda (see DECISIONS.md, 2026-10-19).

| Step | Status |
|------|--------|
| Automated test suite in the repo (API tests + browser tests), run on every PR by GitHub Actions | ✅ |
| Storage layer: disk access behind `storage.py`, with a local-folder backend and an S3 backend (conflict detection via S3 conditional writes); S3 tested against a fake S3 | ✅ |
| `Dockerfile`: Flask + gunicorn + the Lambda Web Adapter; the same image runs locally, on Lambda, or on Proxmox later; built and run on every PR | ✅ |
| File-size limit configurable per environment (`MAPLENOTE_MAX_FILE_BYTES`; 5 MB in the cloud, for Lambda's ~6 MB payload limit) | ✅ |

## Going online (with `cloud-homelab` Phase 2 and 3)

Needs `cloud-homelab` Phase 2 first: Terraform, the S3 backend, GitHub OIDC.

| Step | Status |
|------|--------|
| Sandbox S3 bucket for files (Terraform in `cloud-homelab`) and an `aws-sandbox-check` workflow that signs in via OIDC and runs the storage code against it | ✅ |
| Infrastructure in Terraform (`cloud-homelab`): ECR repository, Lambda, Lambda function URL (decided 2026-10-19) | ✅ applied 2026-10-19 |
| A password in front of the hosted app (`auth.py`), so it's never online unprotected; Lambda refuses to start without one | ✅ |
| Deploy from GitHub Actions via OIDC (no stored AWS keys): `deploy-sandbox` builds, pushes, updates the function and checks it asks for the password | ✅ live 2026-10-19 |
| Login in the app with Cognito, replacing the password (now planned under "Portfolio" below, for Charlie only) | ⬜ |

## Portfolio: a guest mode employers can try (planned 2026-10-20)

Maplenote becomes one tile on a public portfolio site (see `cloud-homelab`
ROADMAP, Phase 4). It stays Charlie's own notes app first. Visitors get the
same editor with no login, and their notes stay in their own browser. See
DECISIONS.md, 2026-10-20.

| Step | Status |
|------|--------|
| Guest mode: opens straight into the editor with no login; notes saved in the browser (IndexedDB) as a new tab kind; a short welcome note on how it's built; never calls the files API | ✅ |
| The `cloud-homelab` side: SCPs on the Workloads OU, the landing page's CloudFront + S3 + WAF in workloads-prod, and its `portfolio` repo (`cloud-homelab` ROADMAP, Phase 4) | ✅ 2026-10-20 |
| Version 1 step 6 (polish) done before the site goes public, since visitors only glance | ✅ 2026-10-22 |
| App side of the move, ready before any AWS change: every non-GET request carries its body's hash (for OAC), the sign-in form is sent by script so it can too, and the "signed in" hint is set at sign-in (the page will come from S3) | ✅ 2026-10-22 |
| **Next:** Frontend served as static files from S3 + CloudFront; only `/api`, `/login` and `/logout` reach Lambda; CloudFront adds the security headers (with the move below; Charlie approves each apply) | ⏭️ |
| Cognito login for Charlie only (sign-up off); signed in means "my notes, synced to S3" | ⬜ |
| Move from sandbox to workloads-prod, alongside the portfolio site. Decided 2026-10-22: prod starts with no notes (nothing copied from sandbox), deploys to prod wait for Charlie's approval in GitHub, Cognito is its own step afterwards, and the sandbox app is removed once prod works | ⬜ |

## Parking lot

Ideas we've discussed but haven't scheduled. Promote one by moving it into a step above.

- Syntax highlighting (CodeMirror language packages: add to `vendor-src/` and rebuild)
- Log viewer mode: open the end of a big file, refresh to follow new lines
- Extra server-side workspace folders (the "Option B" alternative to step 2b)
- Keep `~/maplenote-files` under git, for a version history of notes
- More keyboard shortcuts: next/previous tab (Alt+PageDown/PageUp?) and
  New file. Chrome never gives a page Ctrl+W, Ctrl+T, Ctrl+N or Ctrl+Tab,
  which is why closing a tab is Alt+W (see DECISIONS.md, 2026-10-22).
- Download all notes as a .zip for signed-in use too (today guests only);
  the S3 bucket is versioned, so this would be a convenience, not a backup
- Light theme / theme toggle
- Sidebar right-click menu, drag-and-drop to move files
- Track features and bugs as GitHub Issues once the backlog grows
- Accounts for other people (open sign-up), only if someone actually wants
  one; needs a privacy note, per-user storage and abuse limits first
- Per-file autosave exceptions (e.g. never autosave config files)
- Split `static/app.js` into smaller modules as it grows
- Markdown preview: tick checkboxes by clicking them (edits the `[ ]` in the text)
- Markdown preview: links to other notes (`[x](ideas.md)`) open them in a tab
- Markdown preview: show images stored in the workspace
- Live sync between devices (push changes instead of detecting conflicts on
  save); needs a long-running server or API Gateway WebSockets
- Run the same Docker image on the Proxmox homelab (`docker run` line in the
  `Dockerfile`; already works on any Linux machine with Docker)
- Roll back a deploy from the Actions tab (point the function at an older
  commit's image; today it's one `aws lambda update-function-code` command)
- Tag each version in git (`v0.11.0`) and make a GitHub release from its
  changelog entry, by a workflow after merge
- "What's new" hint: mark the version in the status bar when it changed
  since your last visit
- Guest mode: a "reset" button that restores the welcome note
- Stop the occasional `public.ecr.aws` 429 (see "Known limitations"): sign
  the deploy in first (`aws ecr-public get-login-password --region
  us-east-1 | docker login --username AWS --password-stdin public.ecr.aws`),
  which needs `ecr-public:GetAuthorizationToken` and
  `sts:GetServiceBearerToken` on the deploy role in `cloud-homelab`. The
  account then gets 5 TB a month free instead of the shared 500 GB per IP.
  Doesn't help PR builds (the role trusts `main` only). Drafted and closed
  unmerged on 2026-10-20 (`cloud-homelab#15`, `maplenote#21`) when Charlie
  chose to re-run for now. Promote it if re-runs get annoying
- Retry a newer Playwright (pinned at 1.56): check whether the crash when
  restoring a stored test file handle after a reload is gone in newer Chromium
- Update the docs workflows (`docs-check`, `docs-history`) in both repos from
  `actions/checkout@v4` to v7 (v4 runs on a deprecated Node.js; still works)
- Reserved concurrency of 2 for the Lambda function, if sandbox's account
  limit is ever raised above 10 (a cap on cost and password guessing)
- Keep `docs/DOCS-STANDARD.md` in one shared place (e.g. a template repo)
  instead of copying it between repos, once there are more than two

## Known limitations

- A guest's notes live in one browser: another browser or device can't see
  them, and clearing the site's data deletes them. "Download all" saves a
  .zip, but there's no way to load one back in yet.
- Until the frontend moves to S3 + CloudFront, the sandbox Lambda serves the
  page to anyone with its address (guest mode). Only the page: the files API
  still needs the password. Each visit is a few small requests to Lambda.

- The hosted app has one shared password until Cognito login replaces it.
  Sessions last 30 days; changing the password signs every device out.
  Signing out only clears the browser it's clicked in: other devices stay
  signed in until the 30 days are up or the password changes.
- The keyboard shortcuts can't be changed. Closing a tab is Alt+W, not
  Ctrl+W, because Chrome keeps Ctrl+W for closing its own tab.
- After a while idle, the first request on Lambda takes a second or two
  (a "cold start").
- The hosted app has no request limit of its own and no lockout after wrong
  passwords. Sandbox's Lambda limit of 10 copies at once is the cap (the
  planned reserved concurrency of 2 can't be set there; see `cloud-homelab`
  DECISIONS.md, 2026-10-19). A long random password keeps guessing hopeless.
- In S3 storage, renaming is a copy followed by a delete (S3 has no rename). If
  the second step fails, the file exists under both names; nothing is lost.
- Image builds (the deploy and the PR `tests` image job) download the
  Lambda Web Adapter from AWS's public registry (`public.ecr.aws`) without
  signing in. Anonymous downloads get 500 GB a month **per IP address**,
  and GitHub's runners share their addresses with everyone, so a build
  sometimes fails with "429 Too Many Requests: Data limit exceeded". A
  re-run (another runner, another address) fixes it. Seen twice on
  2026-10-20 (#16's build, the deploy after #20). Fix parked below.
- Files with Windows line endings (CRLF) are saved back with Linux endings (LF).
- Deleting or renaming the last file in a folder leaves the empty folder behind (it's hidden from the sidebar).
- Files opened from the device (↗ tabs) can't be renamed or deleted from Maplenote.
- Saving a device file the first time shows Chrome's "allow editing?" prompt. Until it's
  allowed, autosave pauses for that file and asks for one click on Save.
- Device files (↗) detect outside changes by their "last modified" time, so a change that
  keeps the same time (very rare) could go unnoticed. Workspace files compare contents.
