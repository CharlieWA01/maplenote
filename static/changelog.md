# Changelog

What changed in each version of Maplenote, newest first. The app shows this
file in its About box (the version number at the bottom right), and reads its
own version from the first entry below, so this is the one place the version
number lives. How the numbers work: see `docs/DECISIONS.md`, 2026-10-20,
"A version number and changelog inside the app".

## 1.0.0 · 2026-10-22
Version 1 is finished: everything planned for a simple, Notepad++-style
editor is in.
- **Sign out button** (hosted only). Signing out saves your work first, then
  removes this browser's unsaved drafts and list of open tabs, so the next
  person at a shared computer finds none of your notes.
- **Keyboard shortcuts:** Ctrl+S saves, Alt+W closes the tab (Chrome keeps
  Ctrl+W for itself), Ctrl+E switches a Markdown note between Edit and
  Preview.
- **Guests can keep their notes:** "Download all" saves every note as one
  .zip file, folders included.
- **An icon** in the browser tab.

## 0.11.0 · 2026-10-20
- **About box:** the version number at the bottom right opens this list,
  along with the build the app is running (the commit it was built from,
  and when).

## 0.10.0 · 2026-10-19
- **Guest mode:** visitors who aren't signed in get the full editor with no
  login. Their notes are saved in their own browser and never sent to a
  server. A first visit opens on a welcome note.

## 0.9.0 · 2026-10-19
- **Sign-in page:** the hosted app asks for its password on a page of its
  own instead of the browser's sign-in box, and `/logout` signs out.

## 0.8.0 · 2026-10-19
- **Runs on AWS Lambda:** Maplenote is packaged as one Docker image that runs
  on Lambda, on a laptop or on a home server, and is deployed automatically
  from GitHub. When hosted, it's behind a password.

## 0.7.0 · 2026-10-19
- **Files in Amazon S3:** notes can be stored in an S3 bucket instead of a
  folder, with the same protection against overwriting a change made
  elsewhere.

## 0.6.0 · 2026-10-18
- **Markdown preview:** `.md` files switch between Edit and Preview.
  Checklists (`- [ ]`) show as checkboxes.

## 0.5.0 · 2026-10-18
- **A proper editing area (CodeMirror 6):** undo and redo that survive
  switching tabs, find and replace, line numbers, word wrap, and word and
  line counts.

## 0.4.0 · 2026-10-18
- **Autosave** a moment after you stop typing (it can be switched off).
- **Crash recovery:** unsaved changes are kept in the browser and offered
  back after a crash or a closed tab.
- **Conflict detection:** a save that would overwrite a change made in
  another tab, device or program is refused, and you choose what to keep.

## 0.3.0 · 2026-10-17
- **Open…** edits a text file from anywhere on your device (Downloads, a USB
  stick, Google Drive), saving straight back to it.

## 0.2.0 · 2026-10-17
- **Sidebar, tabs and scratch pad:** a file list with folders, several files
  open at once, and a scratch pad that's always there. Open tabs come back
  after a refresh.

## 0.1.0 · 2026-10-17
- **First version:** a small Python server and a page in the browser to
  open, edit and save one text file.
