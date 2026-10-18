# Design decisions

Why Maplenote is built the way it is. Add an entry whenever we choose between
real alternatives, so nobody (human or Claude) re-argues a settled question
or undoes something without knowing why it was there. Newest first.

---

### Local files open through the browser, not the server (2026-10-18)
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
**How it's built (PR #2):** Tabs have a `kind`: `workspace` (server API),
`device` (browser file handle) or `copy` (fallback; Save downloads a copy).
Device file handles are kept in IndexedDB so those tabs survive a refresh;
if Chrome has forgotten the permission, the tab shows an "Allow access"
button, which asks for read and write together so there's one prompt.
Device files get the same rules as the server: 10 MB limit (the server
reports it in `/api/files`) and must be valid UTF-8. Copy tabs aren't
restored after a refresh.

### Designed with cloud hosting in mind (2026-10-18)
**Decision:** Keep the app ready to containerize and host (e.g. AWS) later,
without building for it yet.
**Consequences:** Settings come from env vars. Step 3 includes edit-conflict
detection (two devices autosaving the same file). Disk access will move behind
a storage layer before hosting. **No public deployment without a login.**

### Work through branches and pull requests (2026-10-18)
**Decision:** Claude works on a branch and opens a PR; Charlie reviews and
merges. Each PR updates the roadmap and this log as needed.
**Why:** `main` only changes when Charlie approves, and the PR history records
what changed and why. Steps 1 and 2 predate this and were committed to `main`.

### The repo is the source of truth (2026-10-18)
**Decision:** Plans and decisions live in `CLAUDE.md`, `docs/ROADMAP.md` and
this file, not in chat history.
**Why:** Claude doesn't remember past sessions; the repo does.

### Scratch pad protected by the server (2026-10-17)
**Decision:** `scratch.txt` is always open in the first tab and can't be
closed, renamed or deleted. The server refuses rename/delete too, not just
the UI.
**Why:** Rules enforced only in the browser can be bypassed. General
principle: enforce rules on the server.

### Open tabs remembered per browser (2026-10-17)
**Decision:** The list of open tabs is stored in the browser's localStorage.
**Why:** Simple, and a per-device tab layout makes sense. File contents are
always loaded fresh from the server.

### Autosave, no "unsaved changes" prompts (2026-10-17)
**Decision:** Step 3 adds autosave about 1 s after typing stops, plus crash
recovery from drafts kept in the browser. No "are you sure?" prompts for
unsaved work. Deleting a file still asks for confirmation (it can't be undone).

### CodeMirror for the editing area (2026-10-17)
**Decision:** Replace the plain `<textarea>` with CodeMirror in step 4,
bundled into `static/vendor/` (no CDN). No syntax highlighting in v1.
**Why:** Undo/redo, find & replace, and line numbers are fiddly and fragile on
a textarea (e.g. programmatic replace breaks Ctrl+Z). CodeMirror is mature
and modular, so syntax highlighting is an easy later add-on.
**Rejected:** Monaco (VS Code's editor): heavier than needed.
**Open question:** CodeMirror 5 (single files, no build step) vs 6 (modern,
needs bundling once); decide in step 4.

### Markdown preview as a toggle, `.md` only (2026-10-17)
**Decision:** An Edit/Preview toggle that appears only on `.md` tabs, not a
side-by-side split.

### Files over 10 MB refused (2026-10-17)
**Decision:** The server refuses files over `MAX_FILE_BYTES` (10 MB).
**Why:** Browsers and editors bog down on very large files. Supporting them
needs a different design (load in chunks, render only the visible part). A
read-only log viewer is parked as the better answer for big logs.

### Safety foundations (2026-10-17)
- **One workspace folder.** Every path is resolved and must stay inside it;
  `../` tricks and symlinks pointing outside are refused.
- **Host header allowlist** (`ALLOWED_HOSTS`) blocks DNS-rebinding attacks,
  where a malicious website gets your browser to talk to a local server.
- **Atomic saves:** write a temp file, then swap it in, so a crash mid-save
  never leaves a half-written file.
- **Binds to 127.0.0.1 by default:** reachable only from the same machine.

### Python + Flask local web app (2026-10-17)
**Decision:** A Python (Flask) server plus a plain HTML/CSS/JS page, used in
the browser at `localhost:8000`.
**Why:** Charlie mostly uses a Chromebook and wants it OS-agnostic. Python
runs everywhere (Chromebook via its Linux environment), the browser is the UI,
and it moves to the cloud naturally. Flask is small and readable; one
dependency.
**Rejected:** Desktop app (platform-specific), terminal editor, FastAPI (more
concepts than needed), Python's built-in `http.server` (more boilerplate).
**Also:** dark theme by default; no build step for the frontend.
