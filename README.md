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

- **`app.py`** is the server: it serves the page and moves text to and from disk.
  It never touches anything outside the workspace folder.
- **`config.py`** holds the settings: workspace folder, port, size limit.
- **`static/`** is the page itself: all the editing happens in the browser.
  Which tabs you had open is remembered by the browser, so a refresh restores them.

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

## Getting updates

```bash
cd ~/maplenote
git pull
```

If the server is running, stop it with `Ctrl+C` and start it again to pick up the changes.

## Troubleshooting

- **Chromebook: `localhost:8000` doesn't load.** Try **http://penguin.linux.test:8000**
  instead. If that fails too, start the server with `MAPLENOTE_HOST=0.0.0.0 python app.py`
  (still only reachable from your Chromebook).
- **"Address already in use".** Another program is using port 8000. Pick a different
  one: `MAPLENOTE_PORT=8001 python app.py`.
