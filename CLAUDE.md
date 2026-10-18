# Maplenote: briefing for Claude

Maplenote is a small, locally hosted text editor that Charlie is building to
use daily and to learn from. Charlie knows some Python, is new to git and
GitHub, and wants to understand the architecture without reading every line.
Explain what you're doing and why, in plain language.

Start of a session: read `docs/ROADMAP.md` (what's done and what's next) and
`docs/DECISIONS.md` (what's been decided and why) before proposing work.

## Architecture

- `app.py`: Flask server. Serves `static/` and a small JSON API over one
  workspace folder. The API is documented in its module docstring.
- `config.py`: every setting, each overridable by a `MAPLENOTE_*` env var.
- `static/`: plain HTML/CSS/JS, no build step. `app.js` holds tabs, sidebar
  and file actions. A tab's `kind` says where its file lives: `workspace`
  (via the server API), `device` (opened with "Open…", read and saved by the
  browser directly; the server never sees it) or `copy` (fallback).
  Every save goes through `saveTab()`; each tab tracks the file `version`
  it last saw, and saves carry it so changes made elsewhere aren't
  overwritten (the server returns 409 for workspace files).
  The editing area is CodeMirror 6 (`static/vendor/codemirror.js`, global
  `CM`): one editor view, and each tab has its own editor state.
  Markdown tabs have an Edit/Preview `mode`; the preview uses markdown-it
  (`static/vendor/markdown-it.js`, global `MD`) with `html: false`.
- Security headers (Content-Security-Policy etc.) are set in `app.py`;
  keep scripts and styles same-origin (no inline scripts, no CDNs).

## Ground rules

- The server never reads or writes outside the workspace folder. Every path
  from the browser goes through `resolve_in_workspace()`.
- Enforce rules on the server, not just in the UI (e.g. the scratch pad is
  protected in both).
- Design for future cloud hosting: config via env vars, no assumptions that
  the server and the user's files share a machine. Nothing goes on the
  public internet without a login.
- Keep it simple and dependency-light. Vendor frontend libraries into
  `static/vendor/`; no CDNs (it must work offline). Bundles are built from
  `vendor-src/` (see its README); rebuild only when upgrading, prefer
  releases a few weeks old, and commit the recipe and bundles together.
- Must run on Python 3.11 (Charlie's Chromebook) and in current Chrome.

## How we work

- Work on a branch and open a pull request; Charlie reviews and merges.
- Each PR updates the docs it affects: mark roadmap items done, record
  design decisions in `docs/DECISIONS.md`, park side ideas in the roadmap's
  parking lot. Code and docs change together.
- Test before pushing: run the server against a scratch workspace and drive
  the page in headless Chromium (Playwright is installed in cloud sessions).
  Type into `.cm-content`; read the text with
  `CM.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString()`.

## Running it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
MAPLENOTE_WORKSPACE=/tmp/ws python app.py   # http://localhost:8000
```
