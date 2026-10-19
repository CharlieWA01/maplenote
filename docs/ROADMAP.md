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
| 6 | Polish: theme details, README | ⏭️ |

## Cloud-ready (local work, no AWS needed)

Target: a Docker image that runs on AWS Lambda (see DECISIONS.md, 2026-10-19).

| Step | Status |
|------|--------|
| Automated test suite in the repo (API tests + browser tests), run on every PR by GitHub Actions | ✅ |
| Storage layer: disk access behind `storage.py`, with a local-folder backend and an S3 backend (conflict detection via S3 conditional writes); S3 tested against a fake S3 | ✅ |
| `Dockerfile`: Flask + gunicorn + the Lambda Web Adapter; the same image runs locally, on Lambda, or on Proxmox later | ⏭️ |
| File-size limit configurable per environment (5 MB in the cloud, for Lambda's ~6 MB payload limit) | ⬜ |

## Going online (with `cloud-homelab` Phase 2 and 3)

Needs `cloud-homelab` Phase 2 first: Terraform, the S3 backend, GitHub OIDC.

| Step | Status |
|------|--------|
| Sandbox S3 bucket for files (Terraform in `cloud-homelab`) and an `aws-sandbox-check` workflow that signs in via OIDC and runs the storage code against it | ✅ |
| Infrastructure in Terraform: ECR repository, Lambda, HTTPS endpoint (API Gateway or Lambda function URL: decide then), Cognito | ⬜ |
| Login in the app (Cognito); required before anything is publicly reachable | ⬜ |
| Deploy from GitHub Actions via OIDC (no stored AWS keys); sign-in itself is proven by `aws-sandbox-check` | ⬜ |

## Parking lot

Ideas we've discussed but haven't scheduled. Promote one by moving it into a step above.

- Syntax highlighting (CodeMirror language packages: add to `vendor-src/` and rebuild)
- Log viewer mode: open the end of a big file, refresh to follow new lines
- Extra server-side workspace folders (the "Option B" alternative to step 2b)
- Keep `~/maplenote-files` under git, for a version history of notes
- More keyboard shortcuts (Ctrl+S, Ctrl+W, Ctrl+Tab, …). CodeMirror's editing ones already work.
- Light theme / theme toggle
- Sidebar right-click menu, drag-and-drop to move files
- Track features and bugs as GitHub Issues once the backlog grows
- Per-file autosave exceptions (e.g. never autosave config files)
- Split `static/app.js` into smaller modules as it grows
- Markdown preview: tick checkboxes by clicking them (edits the `[ ]` in the text)
- Markdown preview: links to other notes (`[x](ideas.md)`) open them in a tab
- Markdown preview: show images stored in the workspace
- Ctrl+E to switch between Edit and Preview (as in Obsidian)
- Live sync between devices (push changes instead of detecting conflicts on
  save); needs a long-running server or API Gateway WebSockets
- Run the same Docker image on the Proxmox homelab
- Retry a newer Playwright (pinned at 1.56): check whether the crash when
  restoring a stored test file handle after a reload is gone in newer Chromium
- Update the docs workflows (`docs-check`, `docs-history`) in both repos from
  `actions/checkout@v4` to v7 (v4 runs on a deprecated Node.js; still works)
- Keep `docs/DOCS-STANDARD.md` in one shared place (e.g. a template repo)
  instead of copying it between repos, once there are more than two

## Known limitations

- In S3 storage, renaming is a copy followed by a delete (S3 has no rename). If
  the second step fails, the file exists under both names; nothing is lost.
- Files with Windows line endings (CRLF) are saved back with Linux endings (LF).
- Deleting or renaming the last file in a folder leaves the empty folder behind (it's hidden from the sidebar).
- Files opened from the device (↗ tabs) can't be renamed or deleted from Maplenote.
- Saving a device file the first time shows Chrome's "allow editing?" prompt. Until it's
  allowed, autosave pauses for that file and asks for one click on Save.
- Device files (↗) detect outside changes by their "last modified" time, so a change that
  keeps the same time (very rare) could go unnoticed. Workspace files compare contents.
