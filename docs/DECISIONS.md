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

### Autosave, crash recovery and conflict detection (2026-10-18, PR #3)
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

### Unsaved-changes warnings when autosave is off (2026-10-18, PR #3 review)
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
**Supersedes:** part of the entry below.

### Autosave, no "unsaved changes" prompts (2026-10-17)
*Partly superseded (2026-10-18): prompts now appear when autosave is off; see above.*
**Decision:** Step 3 adds autosave about 1 s after typing stops, plus crash
recovery from drafts kept in the browser. No "are you sure?" prompts for
unsaved work. Deleting a file still asks for confirmation (it can't be undone).

### CodeMirror 6, bundled once and committed (2026-10-18, PR #4)
**Decision:** Use CodeMirror **6**. The pieces we use are bundled with esbuild
into one file, `static/vendor/codemirror.js` (a global `CM`), which is
committed. The recipe (exact pinned versions, entry file, build command)
lives in `vendor-src/`; license texts in `static/vendor/LICENSE-codemirror.txt`.
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

### CodeMirror for the editing area (2026-10-17)
**Decision:** Replace the plain `<textarea>` with CodeMirror in step 4,
bundled into `static/vendor/` (no CDN). No syntax highlighting in v1.
**Why:** Undo/redo, find & replace, and line numbers are fiddly and fragile on
a textarea (e.g. programmatic replace breaks Ctrl+Z). CodeMirror is mature
and modular, so syntax highlighting is an easy later add-on.
**Rejected:** Monaco (VS Code's editor): heavier than needed.
*Version question settled 2026-10-18: CodeMirror 6 (see above).*

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
