# Roadmap

Status: ✅ done · 🚧 in progress · ⏭️ next · ⬜ planned

## Version 1: a simple, Notepad++-style editor

| # | Step | Status |
|---|------|--------|
| 1 | Flask server + bare editor: open, edit, save one file | ✅ |
| 2 | File sidebar, tabs, pinned scratch pad, tabs restored on refresh | ✅ |
| 2b | **"Open…" button for local files** (Downloads, Google Drive, USB) via the browser's file picker; saves write back to the original file | ✅ |
| 3 | Autosave (~1 s after typing stops), crash recovery (drafts kept in the browser), edit-conflict detection; autosave can be switched off | ✅ |
| 4 | Switch to CodeMirror: undo/redo that survives tab switches, find & replace, line numbers, word-wrap toggle, word/line count | ⏭️ |
| 5 | Markdown preview: Edit/Preview toggle, `.md` files only | ⬜ |
| 6 | Polish: theme details, README | ⬜ |

## Cloud-ready (before hosting anywhere)

| Step | Status |
|------|--------|
| Storage layer: move disk access into `storage.py` so it can be swapped for cloud storage (e.g. S3) | ⬜ |
| `Dockerfile` (containerize) | ⬜ |
| Production web server (gunicorn) instead of Flask's dev server | ⬜ |

## Going online

| Step | Status |
|------|--------|
| Login (required before anything is publicly reachable) | ⬜ |
| HTTPS | ⬜ |
| Deploy to AWS or a simpler host; pick based on cost | ⬜ |

## Parking lot

Ideas we've discussed but haven't scheduled. Promote one by moving it into a step above.

- Syntax highlighting (a CodeMirror plugin, once step 4 lands)
- Log viewer mode: open the end of a big file, refresh to follow new lines
- Extra server-side workspace folders (the "Option B" alternative to step 2b)
- Keep `~/maplenote-files` under git, for a version history of notes
- Keyboard shortcuts (Ctrl+S, Ctrl+W, Ctrl+Tab, …)
- Light theme / theme toggle
- Sidebar right-click menu, drag-and-drop to move files
- Track features and bugs as GitHub Issues once the backlog grows
- Per-file autosave exceptions (e.g. never autosave config files)
- Split `static/app.js` into smaller modules as it grows

## Known limitations

- Files with Windows line endings (CRLF) are saved back with Linux endings (LF).
- Deleting or renaming the last file in a folder leaves the empty folder behind (it's hidden from the sidebar).
- Undo history is lost when switching tabs (fixed by CodeMirror in step 4).
- Files opened from the device (↗ tabs) can't be renamed or deleted from Maplenote.
- Saving a device file the first time shows Chrome's "allow editing?" prompt. Until it's
  allowed, autosave pauses for that file and asks for one click on Save.
- Device files (↗) detect outside changes by their "last modified" time, so a change that
  keeps the same time (very rare) could go unnoticed. Workspace files compare contents.
- With autosave off, closing a tab discards its unsaved edits (on purpose: no prompts).
