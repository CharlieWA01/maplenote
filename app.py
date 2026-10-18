"""Maplenote: a small, locally hosted text editor.

The server has two jobs:
  1. Serve the web page (everything in static/).
  2. Offer a tiny JSON API to list, read and save files in the workspace folder.

All the editing happens in the browser; the server just moves text to and from disk.

API
  GET    /api/files               -> {"files": ["notes.md", ...], "scratch": "scratch.txt",
                                      "max_file_bytes": 10485760}
  GET    /api/file?path=notes.md  -> {"path": "notes.md", "content": "..."}
  PUT    /api/file?path=notes.md  with body {"content": "..."}  -> saves the file
  POST   /api/file?path=notes.md  -> creates a new, empty file (409 if it exists)
  DELETE /api/file?path=notes.md  -> deletes the file
  POST   /api/rename  with body {"from": "a.txt", "to": "b.txt"}  -> renames a file
"""
import os
import tempfile
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import config

app = Flask(__name__, static_folder="static", static_url_path="/static")
# Leave a little room above the file limit for the JSON wrapping around the text.
app.config["MAX_CONTENT_LENGTH"] = config.MAX_FILE_BYTES + 64 * 1024

WORKSPACE = config.WORKSPACE.expanduser().resolve()
WORKSPACE.mkdir(parents=True, exist_ok=True)
SCRATCH = WORKSPACE / config.SCRATCH_FILE


# ---------------------------------------------------------------- safety checks

@app.before_request
def check_host():
    """Refuse requests addressed to a host name we don't recognise."""
    hostname = request.host.rsplit(":", 1)[0]
    if hostname not in config.ALLOWED_HOSTS:
        abort(403, f"Host '{hostname}' is not allowed. Add it to ALLOWED_HOSTS in config.py.")


def resolve_in_workspace(rel_path):
    """Turn a path sent by the browser into a real path on disk.

    Refuses anything that would land outside the workspace, such as
    "../../etc/passwd" or an absolute path like "/home/someone/secret".
    """
    if not rel_path:
        abort(400, "No file path given.")
    target = (WORKSPACE / rel_path).resolve()
    if target == WORKSPACE or not target.is_relative_to(WORKSPACE):
        abort(403, "That path is outside the workspace.")
    return target


def relative(path):
    """The path as the browser sees it: relative to the workspace, with / separators."""
    return path.relative_to(WORKSPACE).as_posix()


def refuse_if_scratch(path, action):
    if path == SCRATCH:
        abort(403, f"The scratch pad can't be {action}.")


@app.errorhandler(HTTPException)
def json_error(error):
    """Send errors back as JSON so the page can show a readable message."""
    return jsonify(error=error.description), error.code


# ------------------------------------------------------------------------ pages

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# -------------------------------------------------------------------------- API

@app.get("/api/files")
def list_files():
    """Every file in the workspace, skipping hidden ones (names starting with '.')."""
    if not SCRATCH.exists():
        SCRATCH.touch()
    files = []
    for folder, subfolders, filenames in os.walk(WORKSPACE):
        # Editing this list in place tells os.walk not to descend into hidden folders.
        subfolders[:] = [name for name in subfolders if not name.startswith(".")]
        for name in filenames:
            if not name.startswith("."):
                files.append(relative(Path(folder) / name))
    return jsonify(
        files=sorted(files, key=str.lower),
        scratch=relative(SCRATCH),
        # The page applies the same limit to files opened from the user's device.
        max_file_bytes=config.MAX_FILE_BYTES,
    )


@app.get("/api/file")
def read_file():
    path = resolve_in_workspace(request.args.get("path", ""))
    if not path.is_file():
        abort(404, "File not found.")
    if path.stat().st_size > config.MAX_FILE_BYTES:
        abort(413, f"File is larger than {config.MAX_FILE_BYTES // (1024 * 1024)} MB.")
    try:
        # newline="" keeps line endings exactly as they are in the file.
        with open(path, encoding="utf-8", newline="") as f:
            content = f.read()
    except UnicodeDecodeError:
        abort(415, "This doesn't look like a text file (it isn't valid UTF-8).")
    return jsonify(path=relative(path), content=content)


@app.put("/api/file")
def save_file():
    path = resolve_in_workspace(request.args.get("path", ""))
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("content"), str):
        abort(400, 'Expected JSON like {"content": "..."}.')
    encoded = data["content"].encode("utf-8")
    if len(encoded) > config.MAX_FILE_BYTES:
        abort(413, f"File is larger than {config.MAX_FILE_BYTES // (1024 * 1024)} MB.")
    path.parent.mkdir(parents=True, exist_ok=True)
    write_atomically(path, encoded)
    return jsonify(path=relative(path), saved=True)


@app.post("/api/file")
def create_file():
    path = resolve_in_workspace(request.args.get("path", ""))
    if path.exists():
        abort(409, f"'{relative(path)}' already exists.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    return jsonify(path=relative(path), created=True)


@app.delete("/api/file")
def delete_file():
    path = resolve_in_workspace(request.args.get("path", ""))
    refuse_if_scratch(path, "deleted")
    if not path.is_file():
        abort(404, "File not found.")
    path.unlink()
    return jsonify(path=relative(path), deleted=True)


@app.post("/api/rename")
def rename_file():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, 'Expected JSON like {"from": "a.txt", "to": "b.txt"}.')
    source = resolve_in_workspace(data.get("from", ""))
    target = resolve_in_workspace(data.get("to", ""))
    refuse_if_scratch(source, "renamed")
    if not source.is_file():
        abort(404, "File not found.")
    if target.exists():
        abort(409, f"'{relative(target)}' already exists.")
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)
    return jsonify(path=relative(target), renamed=True)


def write_atomically(path, data):
    """Write to a temporary file, then swap it into place.

    If the computer crashes mid-save, you keep either the old file or the new
    one, never a half-written mix of both.
    """
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


if __name__ == "__main__":
    print(f"Maplenote is running at http://localhost:{config.PORT}")
    print(f"Workspace folder: {WORKSPACE}")
    print("Press Ctrl+C to stop.\n")
    app.run(host=config.HOST, port=config.PORT)
