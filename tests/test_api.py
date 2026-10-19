"""Tests for the server's JSON API (app.py), without a browser."""
import config
import pytest


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
