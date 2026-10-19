"""Maplenote: a small, locally hosted text editor.

The server has two jobs:
  1. Serve the web page (everything in static/).
  2. Offer a tiny JSON API to list, read and save files in the workspace folder.

All the editing happens in the browser; the server just moves text to and from
storage: a folder on this computer, or an S3 bucket when hosted on AWS (see
storage.py).

API
  GET    /api/files               -> {"files": ["notes.md", ...], "scratch": "scratch.txt",
                                      "max_file_bytes": 10485760}
  GET    /api/file?path=notes.md  -> {"path": "notes.md", "content": "...", "version": "3f9a…"}
  GET    /api/stat?path=notes.md  -> {"path": "notes.md", "version": "3f9a…"}
  PUT    /api/file?path=notes.md  with body {"content": "...", "base_version": "3f9a…"}
                                  -> saves the file; 409 if it no longer matches base_version
  POST   /api/file?path=notes.md  -> creates a new, empty file (409 if it exists)
  DELETE /api/file?path=notes.md  -> deletes the file
  POST   /api/rename  with body {"from": "a.txt", "to": "b.txt"}  -> renames a file

When a password is set (MAPLENOTE_PASSWORD_HASH, on AWS), every request,
pages included, needs a session cookie from the sign-in page (/login) or the
password itself; otherwise the page redirects to /login and everything else
gets a 401. /logout signs out. See auth.py.

A "version" is a fingerprint of a file's contents. The browser sends back the
version it last saw when saving; if the file has changed since (another tab,
another device, another program), the save is refused so nothing is silently
overwritten.
"""
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_from_directory
from werkzeug.exceptions import HTTPException

import auth
import config
import storage
from storage import version_of

app = Flask(__name__, static_folder="static", static_url_path="/static")
# Leave a little room above the file limit for the JSON wrapping around the text.
app.config["MAX_CONTENT_LENGTH"] = config.MAX_FILE_BYTES + 64 * 1024

if config.ON_LAMBDA and not config.PASSWORD_HASH:
    raise RuntimeError("Refusing to run on AWS Lambda without MAPLENOTE_PASSWORD_HASH (see auth.py).")

STORAGE = storage.from_config(config)
SCRATCH = config.SCRATCH_FILE


# ---------------------------------------------------------------- safety checks

@app.before_request
def check_host():
    """Refuse requests addressed to a host name we don't recognise."""
    hostname = request.host.rsplit(":", 1)[0]
    if not host_is_allowed(hostname):
        abort(403, f"Host '{hostname}' is not allowed. Add it to ALLOWED_HOSTS in config.py.")


def host_is_allowed(hostname):
    for allowed in config.ALLOWED_HOSTS:
        if hostname == allowed or (allowed.startswith(".") and hostname.endswith(allowed)):
            return True
    return False


# Reachable without signing in: the sign-in page and its stylesheet.
OPEN_PATHS = {"/login", "/static/style.css"}


@app.before_request
def check_password():
    """When a password is set (on AWS), refuse requests from anyone not signed in.

    Signed in means a valid session cookie (from /login), or the password
    sent with HTTP Basic authentication (for scripts). The page itself is
    redirected to the sign-in page; everything else gets a 401. See auth.py.
    """
    if not config.PASSWORD_HASH or request.path in OPEN_PATHS:
        return None
    if auth.session_is_valid(request.cookies.get(auth.SESSION_COOKIE), config.PASSWORD_HASH):
        return None
    if auth.is_allowed(request.headers.get("Authorization"), config.PASSWORD_HASH):
        return None
    if request.method == "GET" and request.path == "/":
        return redirect("/login", code=303)
    return jsonify(error="Maplenote needs its password: reload the page to sign in."), 401


def login_page(message="", status=200):
    page = (Path(app.static_folder) / "login.html").read_text(encoding="utf-8")
    return page.replace("<!--message-->", message), status


@app.get("/login")
def show_login():
    return login_page()


@app.post("/login")
def log_in():
    """Check the password from the sign-in page; if right, hand out a session cookie."""
    if not config.PASSWORD_HASH:
        return redirect("/", code=303)  # no password set (running locally)
    if not auth.password_is_right(request.form.get("password", ""), config.PASSWORD_HASH):
        return login_page('<p class="login-error">That password isn\'t right.</p>', 401)
    response = redirect("/", code=303)
    response.set_cookie(
        auth.SESSION_COOKIE,
        auth.new_session(config.PASSWORD_HASH),
        max_age=auth.SESSION_SECONDS,
        secure=True,      # only ever sent over HTTPS (browsers make an exception for localhost)
        httponly=True,    # scripts on the page can't read it
        samesite="Lax",   # other sites can't make the browser send it with their requests
    )
    return response


@app.get("/logout")
def log_out():
    response = redirect("/login", code=303)
    response.delete_cookie(auth.SESSION_COOKIE, secure=True, httponly=True, samesite="Lax")
    return response


# Rules the browser enforces on the page, as a second line of defence for the
# Markdown preview (which turns file contents into HTML): only run scripts and
# load styles from this server, never in a frame on another site. Images may
# come from anywhere, so Markdown can show pictures from the web.
# ('unsafe-inline' for styles is needed because CodeMirror adds its own <style> tags.)
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src * data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


@app.after_request
def add_security_headers(response):
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def resolve_in_workspace(rel_path):
    """Turn a path sent by the browser into a storage key like "ideas/todo.md".

    Refuses anything that would land outside the workspace, such as
    "../../etc/passwd" or an absolute path like "/home/someone/secret"
    (the storage backend raises OutsideWorkspace, which becomes a 403).
    """
    return STORAGE.canonical(rel_path)


def refuse_if_scratch(key, action):
    if key == SCRATCH:
        abort(403, f"The scratch pad can't be {action}.")


@app.errorhandler(HTTPException)
def json_error(error):
    """Send errors back as JSON so the page can show a readable message."""
    return jsonify(error=error.description), error.code


# What each storage problem means to the browser. (Saves handle Conflict
# themselves, because their reply carries the file's current version.)
STORAGE_ERROR_STATUS = {
    storage.BadPath: 400,
    storage.OutsideWorkspace: 403,
    storage.NotFound: 404,
    storage.AlreadyExists: 409,
    storage.Conflict: 409,
    storage.TooLarge: 413,
}


@app.errorhandler(storage.StorageError)
def storage_error(error):
    return jsonify(error=str(error)), STORAGE_ERROR_STATUS[type(error)]


# ------------------------------------------------------------------------ pages

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# -------------------------------------------------------------------------- API

@app.get("/api/files")
def list_files():
    """Every file in the workspace, skipping hidden ones (names starting with '.')."""
    if not STORAGE.exists(SCRATCH):
        try:
            STORAGE.create(SCRATCH)
        except storage.AlreadyExists:
            pass  # another request created it a moment ago
    files = STORAGE.list()
    return jsonify(
        files=sorted(files, key=str.lower),
        scratch=SCRATCH,
        # The page applies the same limit to files opened from the user's device.
        max_file_bytes=config.MAX_FILE_BYTES,
    )


@app.get("/api/file")
def read_file():
    key = resolve_in_workspace(request.args.get("path", ""))
    data = STORAGE.read(key, max_bytes=config.MAX_FILE_BYTES)
    try:
        # Decoding the raw bytes keeps line endings exactly as they are in the file.
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        abort(415, "This doesn't look like a text file (it isn't valid UTF-8).")
    return jsonify(path=key, content=content, version=version_of(data))


@app.get("/api/stat")
def stat_file():
    """Just the version, so the page can cheaply check whether a file changed."""
    key = resolve_in_workspace(request.args.get("path", ""))
    return jsonify(path=key, version=STORAGE.version(key))


@app.put("/api/file")
def save_file():
    key = resolve_in_workspace(request.args.get("path", ""))
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("content"), str):
        abort(400, 'Expected JSON like {"content": "..."}.')
    encoded = data["content"].encode("utf-8")
    if len(encoded) > config.MAX_FILE_BYTES:
        abort(413, storage.too_large_message(config.MAX_FILE_BYTES))

    # The storage backend refuses to overwrite changes the browser hasn't seen.
    try:
        version = STORAGE.write(key, encoded, base_version=data.get("base_version"))
    except storage.Conflict as conflict:
        return jsonify(
            error=f"'{key}' was changed somewhere else.",
            conflict=True,
            version=conflict.current_version,
        ), 409
    return jsonify(path=key, saved=True, version=version)


@app.post("/api/file")
def create_file():
    key = resolve_in_workspace(request.args.get("path", ""))
    STORAGE.create(key)
    return jsonify(path=key, created=True)


@app.delete("/api/file")
def delete_file():
    key = resolve_in_workspace(request.args.get("path", ""))
    refuse_if_scratch(key, "deleted")
    STORAGE.delete(key)
    return jsonify(path=key, deleted=True)


@app.post("/api/rename")
def rename_file():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        abort(400, 'Expected JSON like {"from": "a.txt", "to": "b.txt"}.')
    source = resolve_in_workspace(data.get("from", ""))
    target = resolve_in_workspace(data.get("to", ""))
    refuse_if_scratch(source, "renamed")
    STORAGE.rename(source, target)
    return jsonify(path=target, renamed=True)


if __name__ == "__main__":
    print(f"Maplenote is running at http://localhost:{config.PORT}")
    print(f"Files are stored in: {STORAGE.describe()}")
    print("Press Ctrl+C to stop.\n")
    app.run(host=config.HOST, port=config.PORT)
