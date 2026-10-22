"""Tests for the server's JSON API (app.py), without a browser."""
import base64
import os
import subprocess
import sys
import time
from pathlib import Path

import auth
import config
import pytest
from werkzeug.security import generate_password_hash

ROOT = Path(__file__).resolve().parent.parent


def url(path):
    return f"/api/file?path={path}"


def save(client, path, content, **extra):
    return client.put(url(path), json={"content": content, **extra})


# ------------------------------------------------------------- listing files

def test_list_creates_scratch_pad_and_skips_hidden_files(client, workspace):
    (workspace / "notes.md").write_text("hi")
    (workspace / ".secret").write_text("hidden")
    (workspace / ".git").mkdir()
    (workspace / ".git" / "config").write_text("hidden too")
    (workspace / "sub").mkdir()
    (workspace / "sub" / "b.txt").write_text("b")

    data = client.get("/api/files").get_json()

    assert data["files"] == ["notes.md", "scratch.txt", "sub/b.txt"]
    assert data["scratch"] == "scratch.txt"
    assert data["max_file_bytes"] == config.MAX_FILE_BYTES
    assert (workspace / "scratch.txt").exists()


# ------------------------------------------------- reading, saving, versions

def test_save_then_read_round_trip(client, workspace):
    saved = save(client, "ideas/todo.md", "- milk\n").get_json()
    read = client.get(url("ideas/todo.md")).get_json()

    assert (workspace / "ideas" / "todo.md").read_text() == "- milk\n"
    assert read["content"] == "- milk\n"
    assert read["version"] == saved["version"]


def test_reading_keeps_windows_line_endings(client, workspace):
    (workspace / "win.txt").write_bytes(b"a\r\nb\r\n")
    assert client.get(url("win.txt")).get_json()["content"] == "a\r\nb\r\n"


def test_version_changes_with_content_and_stat_reports_it(client):
    first = save(client, "a.txt", "one").get_json()["version"]
    second = save(client, "a.txt", "two").get_json()["version"]

    assert first != second
    assert client.get(url("a.txt").replace("/file", "/stat")).get_json()["version"] == second


def test_stale_save_is_refused_with_409(client, workspace):
    """The heart of conflict detection: a save based on an old version fails."""
    original = save(client, "todo.md", "- milk\n").get_json()["version"]
    save(client, "todo.md", "- milk\n- eggs\n", base_version=original)  # another tab saves

    response = save(client, "todo.md", "- milk\n- bread\n", base_version=original)

    assert response.status_code == 409
    assert response.get_json()["conflict"] is True
    assert response.get_json()["version"] != original
    assert (workspace / "todo.md").read_text() == "- milk\n- eggs\n"  # eggs not lost


def test_save_with_current_version_succeeds(client):
    version = save(client, "a.txt", "one").get_json()["version"]
    assert save(client, "a.txt", "two", base_version=version).status_code == 200


def test_save_without_version_overwrites(client, workspace):
    save(client, "a.txt", "one")
    assert save(client, "a.txt", "two").status_code == 200
    assert (workspace / "a.txt").read_text() == "two"


@pytest.mark.parametrize("body", [{}, {"content": 42}, None])
def test_save_rejects_bad_json(client, body):
    response = client.put(url("a.txt"), json=body) if body is not None else client.put(url("a.txt"), data="x")
    assert response.status_code == 400


def test_missing_file_is_404(client):
    assert client.get(url("nope.txt")).status_code == 404


def test_binary_file_is_refused(client, workspace):
    (workspace / "image.bin").write_bytes(bytes([0xFF, 0xFE, 0x00, 0x81]))
    assert client.get(url("image.bin")).status_code == 415


def test_files_over_the_size_limit_are_refused(client, workspace, monkeypatch):
    monkeypatch.setattr(config, "MAX_FILE_BYTES", 10)
    (workspace / "big.log").write_text("x" * 11)

    assert client.get(url("big.log")).status_code == 413
    assert save(client, "new.txt", "y" * 11).status_code == 413


# ------------------------------------------------- create, rename, delete

def test_create_refuses_to_overwrite(client, workspace):
    assert client.post(url("new.md")).status_code == 200
    assert (workspace / "new.md").read_text() == ""
    assert client.post(url("new.md")).status_code == 409


def test_rename_moves_the_file_and_refuses_to_overwrite(client, workspace):
    save(client, "a.txt", "A")
    save(client, "b.txt", "B")

    assert client.post("/api/rename", json={"from": "a.txt", "to": "b.txt"}).status_code == 409
    assert client.post("/api/rename", json={"from": "a.txt", "to": "notes/c.txt"}).status_code == 200
    assert (workspace / "notes" / "c.txt").read_text() == "A"
    assert not (workspace / "a.txt").exists()


def test_delete_removes_the_file(client, workspace):
    save(client, "a.txt", "A")
    assert client.delete(url("a.txt")).status_code == 200
    assert not (workspace / "a.txt").exists()
    assert client.delete(url("a.txt")).status_code == 404


def test_scratch_pad_cannot_be_renamed_or_deleted(client):
    client.get("/api/files")  # creates it
    assert client.delete(url("scratch.txt")).status_code == 403
    assert client.post("/api/rename", json={"from": "scratch.txt", "to": "x.txt"}).status_code == 403


# ------------------------------------------------------------------ safety

@pytest.mark.parametrize("path", ["../outside.txt", "a/../../outside.txt", "/etc/passwd", "%2e%2e/outside.txt"])
def test_paths_outside_the_workspace_are_refused(client, path):
    assert client.get(url(path)).status_code == 403
    assert save(client, path, "x").status_code == 403


def test_symlink_pointing_outside_is_refused(client, workspace, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("secret")
    (workspace / "link.txt").symlink_to(secret)

    assert client.get(url("link.txt")).status_code == 403


def test_rename_cannot_escape_the_workspace(client):
    save(client, "a.txt", "A")
    response = client.post("/api/rename", json={"from": "a.txt", "to": "../escaped.txt"})
    assert response.status_code == 403


def test_empty_path_is_refused(client):
    assert client.get("/api/file?path=").status_code == 400


def test_unknown_host_header_is_refused(client):
    """Blocks DNS-rebinding attacks: a malicious site pointing its name at us."""
    assert client.get("/api/files", headers={"Host": "evil.example:8000"}).status_code == 403


def test_security_headers_are_sent(client):
    for response in (client.get("/"), client.get("/api/files")):
        policy = response.headers["Content-Security-Policy"]
        assert "script-src 'self'" in policy
        assert "frame-ancestors 'none'" in policy
        assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_errors_are_json(client):
    response = client.get(url("nope.txt"))
    assert response.is_json and "error" in response.get_json()


def test_host_names_starting_with_a_dot_allow_any_name_ending_with_it(client, monkeypatch):
    """How the AWS address is allowed: AWS picks the first part of the name."""
    monkeypatch.setattr(config, "ALLOWED_HOSTS", ["localhost", ".lambda-url.us-east-2.on.aws"])

    def status(host):
        return client.get("/api/files", headers={"Host": host}).status_code

    assert status("abc123.lambda-url.us-east-2.on.aws") == 200
    assert status("lambda-url.us-east-2.on.aws.evil.example") == 403
    assert status("evil-lambda-url.us-east-2.on.aws") == 403
    # Names without a leading dot still have to match exactly.
    assert status("evil-localhost") == 403


# ------------------------------------------- password (when hosted online)

def basic(password, user="charlie"):
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture
def password(monkeypatch):
    """Turns on the password check, as on AWS, with the password 'correct horse'."""
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash("correct horse"))
    monkeypatch.setattr(auth, "_last_accepted", None)
    return "correct horse"


def test_without_a_password_setting_nothing_is_asked(client):
    page = client.get("/")
    assert page.status_code == 200
    # Running locally counts as signed in: the page starts on the real files.
    assert f"{auth.SIGNED_IN_COOKIE}=1" in page.headers["Set-Cookie"]
    assert client.get("/api/files").status_code == 200


def test_sign_out_is_offered_only_when_there_is_a_password(client, monkeypatch):
    """The page shows "Sign out" only when hosted; locally there's nothing to sign out of."""
    assert client.get("/api/files").get_json()["can_sign_out"] is False
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash("correct horse"))
    monkeypatch.setattr(auth, "_last_accepted", None)
    assert client.get("/api/files", headers=basic("correct horse")).get_json()["can_sign_out"] is True


def test_password_is_required_for_the_files_api(client, password):
    for path in ("/api/files", url("scratch.txt"), "/api/stat?path=scratch.txt", "/nowhere"):
        assert client.get(path).status_code == 401, path
    assert client.put(url("a.txt"), json={"content": "x"}).status_code == 401
    assert client.post(url("a.txt")).status_code == 401
    assert client.delete(url("scratch.txt")).status_code == 401
    assert client.post("/api/rename", json={"from": "a.txt", "to": "b.txt"}).status_code == 401
    # No WWW-Authenticate header: it would make the browser show its own
    # sign-in box locally, and AWS drops it anyway.
    assert "WWW-Authenticate" not in client.get("/api/files").headers


def test_sign_out_works_even_when_the_session_has_already_ended(client, password):
    """Clicking "Sign out" after the 30 days are up must still land on the sign-in
    page, not on a 401. Signing out only removes cookies, so it's safe to leave open."""
    response = client.get("/logout")
    assert response.status_code == 303
    assert response.headers["Location"].endswith("/login")


def test_page_and_scripts_are_open_for_guest_mode(client, password):
    """Guest mode runs in the browser, so the page loads without signing in,
    with the "signed in" hint cleared so the page starts as a guest."""
    page = client.get("/")
    assert page.status_code == 200
    cookie = page.headers["Set-Cookie"]
    assert cookie.startswith(f"{auth.SIGNED_IN_COOKIE}=;") and "Max-Age=0" in cookie
    for path in ("/static/app.js", "/static/style.css", "/static/welcome.md", "/static/changelog.md",
                 "/static/vendor/codemirror.js"):
        assert client.get(path).status_code == 200, path
    # Faking the hint gets the page, never the files.
    client.set_cookie(auth.SIGNED_IN_COOKIE, "1")
    assert client.get("/api/files").status_code == 401


def test_sign_in_page_and_its_style_are_open(client, password):
    page = client.get("/login")
    assert page.status_code == 200
    assert 'name="password"' in page.get_data(as_text=True)
    assert client.get("/static/style.css").status_code == 200


def sign_in(client, attempt):
    return client.post("/login", data={"password": attempt})


def test_signing_in_sets_a_cookie_that_lets_everything_through(client, password):
    response = sign_in(client, password)
    assert response.status_code == 303 and response.headers["Location"].endswith("/")
    cookie = response.headers["Set-Cookie"]
    for flag in ("HttpOnly", "Secure", "SameSite=Lax", "Max-Age=2592000"):
        assert flag in cookie, flag
    # The test client keeps the cookie, like a browser. The page now tells
    # its script to start signed in, with a cookie scripts can read.
    page = client.get("/")
    assert page.status_code == 200
    hint = page.headers["Set-Cookie"]
    assert hint.startswith(f"{auth.SIGNED_IN_COOKIE}=1;") and "HttpOnly" not in hint
    assert client.put(url("a.txt"), json={"content": "hi"}).status_code == 200
    assert client.get(url("a.txt")).get_json()["content"] == "hi"


def test_wrong_password_on_the_sign_in_page(client, password):
    response = sign_in(client, "wrong horse")
    assert response.status_code == 401
    assert "isn't right" in response.get_data(as_text=True)
    assert "Set-Cookie" not in response.headers
    assert client.get("/api/files").status_code == 401


def test_signing_out_ends_the_session(client, password):
    sign_in(client, password)
    response = client.get("/logout")
    assert response.headers["Location"].endswith("/login")
    cleared = response.headers.getlist("Set-Cookie")
    for name in (auth.SESSION_COOKIE, auth.SIGNED_IN_COOKIE):
        assert any(c.startswith(f"{name}=;") for c in cleared), name
    assert client.get("/api/files").status_code == 401


def test_forged_old_or_outdated_cookies_are_refused(client, password, monkeypatch):
    now = time.time()
    hash_now = config.PASSWORD_HASH
    for value in (
        "",
        "garbage",
        f"{int(now)}.{'0' * 64}",  # right shape, wrong signature
        auth.new_session(hash_now, now=now - auth.SESSION_SECONDS - 1),  # too old
        auth.new_session(hash_now, now=now + 3600),  # from the future
        auth.new_session(generate_password_hash("old password")),  # before a password change
    ):
        client.set_cookie(auth.SESSION_COOKIE, value)
        assert client.get("/api/files").status_code == 401, value
    client.set_cookie(auth.SESSION_COOKIE, auth.new_session(hash_now))
    assert client.get("/api/files").status_code == 200


def test_wrong_or_malformed_passwords_are_refused(client, password):
    for headers in (
        basic("wrong horse"),
        basic(""),
        {"Authorization": "Basic not-base64!"},
        {"Authorization": "Bearer correct horse"},
        {"Authorization": "Basic " + base64.b64encode(b"no colon here").decode()},
    ):
        assert client.get("/api/files", headers=headers).status_code == 401, headers


def test_right_password_lets_everything_through(client, password):
    headers = basic(password)  # how scripts sign in (e.g. curl -u any:password)
    assert client.get("/", headers=headers).status_code == 200
    saved = client.put(url("a.txt"), json={"content": "hi"}, headers=headers)
    assert saved.status_code == 200
    # The second request is accepted from memory, without the slow hash check.
    assert auth._last_accepted == headers["Authorization"]
    assert client.get(url("a.txt"), headers=headers).get_json()["content"] == "hi"


def test_the_username_is_ignored(client, password):
    assert client.get("/api/files", headers=basic(password, user="anyone")).status_code == 200


def test_remembered_password_doesnt_let_a_different_one_in(client, password):
    assert client.get("/api/files", headers=basic(password)).status_code == 200
    assert client.get("/api/files", headers=basic("guess")).status_code == 401


def test_refuses_to_start_on_lambda_without_a_password(workspace):
    """A missing setting must not put the notes online unprotected."""
    env = {**os.environ, "AWS_LAMBDA_FUNCTION_NAME": "cwa-maplenote", "MAPLENOTE_PASSWORD_HASH": ""}
    result = subprocess.run(
        [sys.executable, "-c", "import app"], cwd=ROOT, env=env, capture_output=True, text=True
    )
    assert result.returncode != 0
    assert "without MAPLENOTE_PASSWORD_HASH" in result.stderr

    env["MAPLENOTE_PASSWORD_HASH"] = generate_password_hash("correct horse")
    result = subprocess.run([sys.executable, "-c", "import app"], cwd=ROOT, env=env)
    assert result.returncode == 0


def test_file_size_limit_can_be_set_per_environment(workspace):
    env = {**os.environ, "MAPLENOTE_MAX_FILE_BYTES": "5242880"}
    result = subprocess.run(
        [sys.executable, "-c", "import config; print(config.MAX_FILE_BYTES)"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    assert result.stdout.strip() == "5242880"


# ------------------------------------------------- version and changelog

CHANGELOG = Path(__file__).resolve().parent.parent / "static" / "changelog.md"


def test_changelog_entries_are_well_formed_and_newest_first():
    """The page reads its version from the first entry (static/app.js), so every
    entry must be a "## 1.2.3 · YYYY-MM-DD" heading, each version higher than
    the one below it and never dated earlier."""
    import re
    headings = [line for line in CHANGELOG.read_text(encoding="utf-8").splitlines() if line.startswith("## ")]
    assert headings, "the changelog has no entries"
    entries = []
    for heading in headings:
        match = re.fullmatch(r"## (\d+)\.(\d+)\.(\d+) · (\d{4}-\d{2}-\d{2})", heading)
        assert match, f"badly formed changelog heading: {heading!r}"
        entries.append((tuple(int(n) for n in match.groups()[:3]), match.group(4)))
    for (newer, newer_date), (older, older_date) in zip(entries, entries[1:]):
        assert newer > older, f"{newer} is listed above {older} but isn't higher"
        assert newer_date >= older_date, f"{newer} is dated before {older}"
