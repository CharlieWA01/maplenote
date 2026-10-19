"""Tests for the storage backends (storage.py).

The same "contract" tests run against both backends, which is what lets
app.py treat them as interchangeable:
  - LocalStorage, on a temporary folder;
  - S3Storage, on a fake S3 provided by the moto library. moto answers boto3's
    calls in memory, the way real S3 would, so no AWS account (and no cost)
    is involved.

Then a few tests cover what only S3 has to deal with: two saves racing on
different machines, objects uploaded outside Maplenote, and prefixes.
Finally, the whole API is exercised once with S3 storage behind it.
"""
import boto3
import pytest
from moto import mock_aws

import app as maplenote
import storage
from storage import version_of

BUCKET = "maplenote-test"


@pytest.fixture
def s3(monkeypatch):
    """A boto3 S3 client talking to a fake S3 with one empty bucket."""
    # Fake credentials, so boto3 can never reach a real AWS account.
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-2")
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-2")
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-east-2"}
        )
        yield client


@pytest.fixture(params=["local", "s3"])
def store(request, tmp_path):
    if request.param == "local":
        return storage.LocalStorage(tmp_path / "workspace")
    return storage.S3Storage(BUCKET, client=request.getfixturevalue("s3"))


# ------------------------------------------------------ the shared contract

def test_write_then_read(store):
    version = store.write("ideas/todo.md", b"- milk\n")
    assert store.read("ideas/todo.md") == b"- milk\n"
    assert store.version("ideas/todo.md") == version == version_of(b"- milk\n")


def test_list_skips_hidden_files_and_folders(store):
    for key in ["notes.md", "sub/b.txt", ".secret", ".git/config", "sub/.hidden"]:
        store.write(key, b"x")
    assert sorted(store.list()) == ["notes.md", "sub/b.txt"]


def test_missing_file(store):
    with pytest.raises(storage.NotFound):
        store.read("nope.txt")
    with pytest.raises(storage.NotFound):
        store.version("nope.txt")
    with pytest.raises(storage.NotFound):
        store.delete("nope.txt")
    assert not store.exists("nope.txt")


def test_size_limit(store):
    store.write("big.log", b"x" * 11)
    with pytest.raises(storage.TooLarge):
        store.read("big.log", max_bytes=10)
    assert store.read("big.log", max_bytes=11) == b"x" * 11


def test_stale_write_is_refused_and_keeps_the_newer_contents(store):
    original = store.write("todo.md", b"- milk\n")
    newer = store.write("todo.md", b"- milk\n- eggs\n", base_version=original)

    with pytest.raises(storage.Conflict) as refused:
        store.write("todo.md", b"- milk\n- bread\n", base_version=original)

    assert refused.value.current_version == newer
    assert store.read("todo.md") == b"- milk\n- eggs\n"


def test_write_with_a_base_version_recreates_a_deleted_file(store):
    version = store.write("a.txt", b"one")
    store.delete("a.txt")
    store.write("a.txt", b"two", base_version=version)
    assert store.read("a.txt") == b"two"


def test_create_refuses_to_overwrite(store):
    store.create("new.md")
    assert store.read("new.md") == b""
    with pytest.raises(storage.AlreadyExists):
        store.create("new.md")


def test_rename(store):
    store.write("a.txt", b"A")
    store.write("b.txt", b"B")

    with pytest.raises(storage.AlreadyExists):
        store.rename("a.txt", "b.txt")
    store.rename("a.txt", "notes/c.txt")

    assert store.read("notes/c.txt") == b"A"
    assert not store.exists("a.txt")
    with pytest.raises(storage.NotFound):
        store.rename("a.txt", "d.txt")


def test_delete(store):
    store.write("a.txt", b"A")
    store.delete("a.txt")
    assert not store.exists("a.txt")


@pytest.mark.parametrize("path", ["../x.txt", "a/../../x.txt", "/etc/passwd", "..", "."])
def test_paths_outside_are_refused(store, path):
    with pytest.raises(storage.OutsideWorkspace):
        store.canonical(path)


@pytest.mark.parametrize("path", ["", "a\0b.txt"])
def test_bad_paths_are_refused(store, path):
    with pytest.raises(storage.BadPath):
        store.canonical(path)


def test_paths_are_tidied(store):
    assert store.canonical("a/./b/../c.txt") == "a/c.txt"


# ---------------------------------------------------------- S3 only

def test_s3_race_between_check_and_write_is_a_conflict(s3, monkeypatch):
    """Two saves on different machines: both pass the version check, only one may win.

    This simulates another save landing in the gap between our check and our
    write. S3's If-Match condition is what catches it.
    """
    store = storage.S3Storage(BUCKET, client=s3)
    original = store.write("todo.md", b"- milk\n")
    check = store._version_and_etag

    def check_then_someone_else_saves(key):
        result = check(key)
        storage.S3Storage(BUCKET, client=s3).write(key, b"- milk\n- eggs\n")
        return result

    monkeypatch.setattr(store, "_version_and_etag", check_then_someone_else_saves)
    with pytest.raises(storage.Conflict) as refused:
        store.write("todo.md", b"- milk\n- bread\n", base_version=original)

    assert refused.value.current_version == version_of(b"- milk\n- eggs\n")
    assert store.read("todo.md") == b"- milk\n- eggs\n"


def test_s3_race_on_a_new_file_is_a_conflict(s3, monkeypatch):
    """Saving a file that was deleted, while someone else re-creates it."""
    store = storage.S3Storage(BUCKET, client=s3)
    check = store._version_and_etag

    def check_then_someone_else_creates(key):
        result = check(key)
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"theirs")
        return result

    monkeypatch.setattr(store, "_version_and_etag", check_then_someone_else_creates)
    with pytest.raises(storage.Conflict):
        store.write("a.txt", b"mine", base_version="0123456789abcdef")
    assert store.read("a.txt") == b"theirs"


def test_s3_objects_uploaded_elsewhere_get_a_version(s3):
    """An object uploaded with the console or CLI has no stored version; it's computed."""
    s3.put_object(Bucket=BUCKET, Key="uploaded.md", Body=b"from the console")
    store = storage.S3Storage(BUCKET, client=s3)

    assert store.version("uploaded.md") == version_of(b"from the console")
    with pytest.raises(storage.Conflict):
        store.write("uploaded.md", b"mine", base_version="0123456789abcdef")
    store.write("uploaded.md", b"mine", base_version=version_of(b"from the console"))
    assert store.read("uploaded.md") == b"mine"


def test_s3_stores_the_version_in_metadata(s3):
    storage.S3Storage(BUCKET, client=s3).write("a.txt", b"one")
    head = s3.head_object(Bucket=BUCKET, Key="a.txt")
    assert head["Metadata"][storage.S3Storage.VERSION_KEY] == version_of(b"one")


def test_s3_prefix_keeps_files_apart(s3):
    s3.put_object(Bucket=BUCKET, Key="other/secret.txt", Body=b"not ours")
    s3.put_object(Bucket=BUCKET, Key="notes/", Body=b"")  # a "folder" placeholder
    store = storage.S3Storage(BUCKET, prefix="/notes/", client=s3)

    store.write("a.txt", b"A")

    assert store.list() == ["a.txt"]
    assert s3.get_object(Bucket=BUCKET, Key="notes/a.txt")["Body"].read() == b"A"
    with pytest.raises(storage.OutsideWorkspace):
        store.canonical("../other/secret.txt")


def test_s3_needs_a_bucket():
    with pytest.raises(ValueError):
        storage.S3Storage("")


def test_unknown_storage_setting_is_refused():
    class Settings:
        STORAGE = "floppy"

    with pytest.raises(ValueError):
        storage.from_config(Settings)


# ------------------------------------------------- the API, backed by S3

def test_api_works_with_s3_storage(s3, client, monkeypatch):
    monkeypatch.setattr(maplenote, "STORAGE", storage.S3Storage(BUCKET, client=s3))

    def url(path):
        return f"/api/file?path={path}"

    assert client.get("/api/files").get_json()["files"] == ["scratch.txt"]
    saved = client.put(url("todo.md"), json={"content": "- milk\n"}).get_json()
    assert client.get(url("todo.md")).get_json()["content"] == "- milk\n"
    assert client.get("/api/stat?path=todo.md").get_json()["version"] == saved["version"]

    client.put(url("todo.md"), json={"content": "- eggs\n", "base_version": saved["version"]})
    stale = client.put(url("todo.md"), json={"content": "- bread\n", "base_version": saved["version"]})
    assert stale.status_code == 409 and stale.get_json()["conflict"] is True

    assert client.post(url("todo.md")).status_code == 409
    assert client.post("/api/rename", json={"from": "todo.md", "to": "done.md"}).status_code == 200
    assert client.delete(url("done.md")).status_code == 200
    assert client.delete(url("scratch.txt")).status_code == 403
    assert client.get(url("../x.txt")).status_code == 403
    assert client.get(url("nope.txt")).status_code == 404
    assert s3.list_objects_v2(Bucket=BUCKET)["KeyCount"] == 1  # just the scratch pad
