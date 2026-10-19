# maplenote

A simple, locally hosted text editor. A small Python server reads and writes
files in one folder on your computer, and you edit them in a browser tab.

## How it fits together

```
 Browser tab (localhost:8000)          Python server (app.py)          Your disk
┌────────────────────────────┐       ┌────────────────────────┐      ┌────────────────────┐
│ static/index.html          │ ←───→ │ GET    /api/files      │ ←──→ │ ~/maplenote-files/ │
│ static/app.js  (logic)     │  JSON │ GET    /api/file?path= │      │   scratch.txt      │
│ static/style.css (looks)   │       │ PUT    /api/file  save │      │   notes.md         │
│                            │       │ POST   /api/file  new  │      │   ...              │
│                            │       │ DELETE /api/file       │      │                    │
│                            │       │ POST   /api/rename     │      │                    │
└────────────────────────────┘       └────────────────────────┘      └────────────────────┘
```

- **`app.py`** is the server: it serves the page and moves text to and from storage.
  It never touches anything outside the workspace folder.
- **`storage.py`** decides where files live: a folder on your computer (the
  default), or an Amazon S3 bucket when Maplenote is hosted on AWS
  (`MAPLENOTE_STORAGE=s3` plus `MAPLENOTE_S3_BUCKET`). The server code is the
  same either way.
- **`config.py`** holds the settings: storage, workspace folder, port, size limit,
  password.
- **`auth.py`** is the password check for when Maplenote is online (on AWS);
  locally there's no password.
- **`Dockerfile`** packages all of it as one Docker image, which runs on AWS
  Lambda or on any machine with Docker (see "Running it in Docker").
- **`static/`** is the page itself: all the editing happens in the browser.
  Which tabs you had open is remembered by the browser, so a refresh restores them.
  The editing area is [CodeMirror 6](https://codemirror.net/) and the Markdown
  preview uses [markdown-it](https://github.com/markdown-it/markdown-it), both
  bundled into `static/vendor/` (how they're built: [`vendor-src/`](vendor-src/README.md)).

## Docs

| Path | What it holds |
|---|---|
| [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md) | One-page summary: what it is, how it's built, resume bullets |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's done, what's next, parking lot, known limitations |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every design decision, the alternatives, and why |
| [`docs/journal/`](docs/journal/) | Dated entries: what was done in each work session |
| [`docs/interview/`](docs/interview/README.md) | STAR-style stories from the build |
| [`docs/runbooks/`](docs/runbooks/) | Repeatable procedures (running, updating, testing a PR) |
| [`docs/HISTORY.md`](docs/HISTORY.md) | Every merged change, recorded automatically |
| [`docs/DOCS-STANDARD.md`](docs/DOCS-STANDARD.md) | How and why all of the above is kept |

## First-time setup

Needs Python 3.9 or newer. On a Chromebook, run these in the Linux terminal.

```bash
cd ~/maplenote
python3 -m venv .venv                # a private Python environment for this project
source .venv/bin/activate            # switch into it
pip install -r requirements.txt      # install Flask
```

## Running it

```bash
cd ~/maplenote
source .venv/bin/activate
python app.py
```

Then open **http://localhost:8000** in your browser. Press `Ctrl+C` in the
terminal to stop the server.

Your files live in `~/maplenote-files` (created automatically). `scratch.txt` in
that folder is the scratch pad: always open in the first tab, and it can't be
renamed or deleted.

To use a different folder:

```bash
MAPLENOTE_WORKSPACE=~/Documents python app.py
```

### Editing

- **Undo / redo:** Ctrl+Z / Ctrl+Y (each tab keeps its own history).
- **Find & replace:** the **Find** button or Ctrl+F. Supports match case,
  regular expressions and whole words; Enter jumps to the next match.
- **Word wrap:** toggle in the status bar under the editor (on by default).
- The status bar also shows the cursor's line and column, how much is
  selected, and the word and line counts.

### Markdown preview

Markdown files (`.md`) get an **Edit | Preview** switch at the right end of
the tab row. Preview shows the formatted note: headings, lists, `- [ ]`
checkboxes, tables, code blocks, quotes and links. Web links open in a new
browser tab. Each tab remembers which mode it's in.

For safety, HTML written inside a note is shown as text rather than run.

### Saving

**Autosave** (the toolbar checkbox, on by default) saves about a second after
you stop typing. **Save** always saves right away. Either way:

- **Crash recovery:** unsaved text is kept in the browser. If Maplenote didn't
  get to save it (the server was stopped, the computer crashed, or autosave was
  off), you'll be offered the recovered changes next time.
- **Conflicts:** if a file was changed somewhere else (another tab, another
  device, another program) while you had unsaved edits, Maplenote won't
  overwrite it. A bar above the editor lets you **load their version**, **keep
  yours**, or **save yours as a copy** (`name (conflict).md`). If you had no
  unsaved edits, it simply reloads the new version.
- **Closing with unsaved edits:** with autosave on, closing a tab saves it.
  With autosave off, Maplenote asks **Save / Don't save / Cancel**, and the
  browser warns before you close or refresh the page.

### Opening files from anywhere on your device

**Open…** opens any text file your browser can reach: Downloads, Google
Drive, a USB stick. These tabs are marked **↗**, and saving writes straight
back to the original file. The browser handles these files directly; they
never pass through the server.

- Chrome asks permission the first time you save a file, and may ask again
  (an **Allow access** button) after a refresh.
- Saving back needs Chrome or Edge at **http://localhost:8000**. Other
  browsers, or the `penguin.linux.test` address, can still open files, but
  Save downloads a copy instead.

## Running it in Docker

The same image that runs on AWS runs on any Linux machine with Docker (a
homelab server, for example). Your files stay in a folder on that machine:

```bash
docker build -t maplenote .
docker run --rm -p 8000:8080 -v ~/maplenote-files:/data maplenote
```

Then open **http://localhost:8000**. To require a password, make a hash with
`python auth.py` and add `-e MAPLENOTE_PASSWORD_HASH='<the hash>'` (single
quotes: the hash contains `$` signs). Hosting on AWS: see
[`docs/runbooks/deploy-sandbox.md`](docs/runbooks/deploy-sandbox.md).

## Running the tests

104 automated tests check the server's API and storage and drive the app in a real
browser. GitHub Actions runs them on every pull request. To run them yourself:

```bash
cd ~/maplenote
source .venv/bin/activate
pip install -r requirements-dev.txt     # first time only
python -m playwright install chromium   # first time only: the browser the tests drive
python -m pytest                        # everything, about a minute
python -m pytest tests/test_api.py      # just the API tests, under a second
```

- `tests/test_api.py`: the JSON API, including every safety rule.
- `tests/test_storage.py`: both storage backends pass the same tests; the S3
  one runs against a fake S3 (the `moto` library), so no AWS account is used.
- `tests/browser/`: real scenarios in Chromium: editing, conflicts, crash
  recovery, the unsaved-changes dialog, device files, the Markdown preview.
- `tests/test_real_s3.py`: the same storage code against the real S3 bucket
  in the AWS sandbox account. Skipped everywhere except the
  `aws-sandbox-check` workflow, which signs in to AWS first (see
  `docs/runbooks/aws-sandbox-check.md`).

## Getting updates

```bash
cd ~/maplenote
git pull
```

If the server is running, stop it with `Ctrl+C` and start it again to pick up the changes.

## Troubleshooting

- **Chromebook: `localhost:8000` doesn't load.** Try **http://penguin.linux.test:8000**
  instead (saving files opened with **Open…** won't work there; see above). If that fails too, start the server with `MAPLENOTE_HOST=0.0.0.0 python app.py`
  (still only reachable from your Chromebook).
- **"Address already in use".** Another program is using port 8000. Pick a different
  one: `MAPLENOTE_PORT=8001 python app.py`.
