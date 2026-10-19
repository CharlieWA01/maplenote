"""Maplenote's storage against a real S3 bucket (the sandbox one).

Every other test uses a fake S3 (moto). These run only when
MAPLENOTE_LIVE_S3_BUCKET is set, which the aws-sandbox-check workflow does
after signing in to AWS through the GitHub deploy role. Everywhere else
(your laptop, the tests workflow) they're skipped.

The deploy role may only touch the bucket's ci-check/ "folder", so each run
works in ci-check/<run id>/ and empties it afterwards. The bucket deletes
anything left there after a day.
"""
import os
import uuid

import pytest

import app as maplenote
import storage
from storage import version_of

BUCKET = os.environ.get("MAPLENOTE_LIVE_S3_BUCKET", "")
CI_FOLDER = "ci-check/"

pytestmark = pytest.mark.skipif(
    not BUCKET, reason="MAPLENOTE_LIVE_S3_BUCKET not set (only the aws-sandbox-check workflow sets it)"
)


@pytest.fixture
def s3():
    import boto3

    return boto3.client("s3")


@pytest.fixture
def prefix(s3):
    """A folder of its own for this test, emptied afterwards."""
    run = os.environ.get("GITHUB_RUN_ID", "local")
    prefix = f"{CI_FOLDER}{run}-{uuid.uuid4().hex[:8]}/"
    yield prefix
    listed = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix).get("Contents", [])
    for item in listed:
        s3.delete_object(Bucket=BUCKET, Key=item["Key"])


@pytest.fixture
def store(s3, prefix):
    return storage.S3Storage(BUCKET, prefix=prefix, client=s3)


def test_the_api_works_on_the_real_bucket(store, s3, prefix, client, monkeypatch):
    """The same journey as test_api_works_with_s3_storage, on real S3."""
    monkeypatch.setattr(maplenote, "STORAGE", store)

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
    assert client.get(url("nope.txt")).status_code == 404
    assert s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)["KeyCount"] == 1  # the scratch pad


def test_real_s3_refuses_a_save_that_lost_a_race(store, s3, monkeypatch):
    """S3's own If-Match check stops the second of two racing saves.

    moto imitates this in test_storage.py; this proves real S3 does it too.
    """
    original = store.write("todo.md", b"- milk\n")
    check = store._version_and_etag

    def check_then_someone_else_saves(key):
        result = check(key)
        storage.S3Storage(BUCKET, prefix=store.prefix, client=s3).write(key, b"- milk\n- eggs\n")
        return result

    monkeypatch.setattr(store, "_version_and_etag", check_then_someone_else_saves)
    with pytest.raises(storage.Conflict):
        store.write("todo.md", b"- milk\n- bread\n", base_version=original)
    assert store.read("todo.md") == b"- milk\n- eggs\n"


def test_files_are_encrypted_at_rest(store, s3, prefix):
    store.write("a.txt", b"secret plans")
    head = s3.head_object(Bucket=BUCKET, Key=f"{prefix}a.txt")
    assert head["ServerSideEncryption"] == "AES256"
    assert head["Metadata"][storage.S3Storage.VERSION_KEY] == version_of(b"secret plans")


def test_the_deploy_role_cannot_open_files_outside_ci_check(s3):
    """Least privilege: the GitHub role can't read or write real notes."""
    from botocore.exceptions import ClientError

    with pytest.raises(ClientError) as read:
        s3.get_object(Bucket=BUCKET, Key="scratch.txt")
    with pytest.raises(ClientError) as write:
        s3.put_object(Bucket=BUCKET, Key="written-by-ci.txt", Body=b"x")
    assert read.value.response["Error"]["Code"] == "AccessDenied"
    assert write.value.response["Error"]["Code"] == "AccessDenied"
