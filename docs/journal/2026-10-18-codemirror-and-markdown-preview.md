# 2026-10-18: CodeMirror editor and Markdown preview

*Backfilled on 2026-10-19 from the working session.*

## Goal
Replace the plain text box with a real editor (line numbers, find & replace,
proper undo, word wrap, counts), then add a Markdown preview. These were the
last two feature steps of version 1.

## What was done

**CodeMirror 6** ([PR #4][pr4]). The parked question "CodeMirror 5 or 6?" was
settled: 6, because 5 is in maintenance mode, 6 is better on touch screens
and is what Obsidian uses. Its catch (it ships as many small packages that
need bundling) only applies when upgrading. The pieces Maplenote uses are
bundled once with esbuild into `static/vendor/codemirror.js` and committed
("vendoring"), so running the app still needs only Python and works offline.
The recipe (exact pinned versions, entry file, build command) lives in
`vendor-src/`. One editor on screen; each tab owns its own CodeMirror state
(text, cursor, undo history), so **undo survives switching tabs**. Added a
Find button, line numbers, word wrap toggle and a status bar with line/column,
selection size and word/line counts.

**Markdown preview** ([PR #5][pr5]). `.md` tabs got an Edit | Preview switch
(where Obsidian puts it). Rendered with markdown-it; single line breaks kept,
`- [ ]` / `- [x]` as checkboxes, web links open in a new tab, each tab
remembers its mode. Because the preview turns file contents into HTML, and
files can come from anywhere, it has **two layers of protection**:
markdown-it with `html: false` (HTML in a note is shown as text), and a
**Content-Security-Policy** header from the server so the browser refuses to
run any script that didn't come from Maplenote.

**Supply-chain caution.** The newest markdown-it release was two days old, so
the newest version that had been out for five weeks (15.0.2) was pinned
instead; this became a rule in `CLAUDE.md` and `vendor-src/README.md`. The
license texts of everything bundled are in
`static/vendor/THIRD-PARTY-LICENSES.txt`.

## Problems and fixes
- **A test that failed for the right reason.** A preview test typed "Draft: "
  in front of `# Weekend plans` and then looked for a heading, but that text
  stops the line being a heading in Markdown, so the preview was correct. The
  test was fixed, not the app.
- **The table in the preview was centred** while everything else was
  left-aligned. Fixed by centring the reading column as a whole.

## How it was verified
- **CodeMirror:** typing, autosave, Ctrl+Z / Ctrl+Y, undo after switching
  tabs, Find → replace all → undo, word wrap, status bar counts, recovered
  drafts being undoable.
- **Big file:** an 8 MB, 120,000-line log opened in about 0.2 s, stayed
  responsive while typing, and Find reached the last line in about 1 s.
- **Offline:** the page made no requests outside `localhost`.
- **Security:** a note full of injection attempts (`<script>`,
  `<img onerror=…>`, `javascript:` links) rendered as harmless text; nothing
  ran; no console errors under the new policy.
- **Everything earlier** (autosave, conflicts, recovery, device files, the
  dialog, the download fallback) re-run against the new editor.
- Charlie tested both PRs on the Chromebook before merging ("All tests look
  good").

## Impact
All five feature steps of version 1 done in two days, from a blank repo.
What's left: polish, then the cloud-ready work (storage layer, Dockerfile,
production server) and going online with a login on AWS.

[pr4]: https://github.com/CharlieWA01/maplenote/pull/4
[pr5]: https://github.com/CharlieWA01/maplenote/pull/5
