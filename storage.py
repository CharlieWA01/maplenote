"""Where Maplenote's files live.

app.py never touches files directly. It asks a *storage backend*, and the
backend decides what "a file" means:

  LocalStorage  a folder on this computer (the workspace). Used day to day.
  S3Storage     objects in an Amazon S3 bucket. Used when hosted on AWS.

Both offer the same handful of operations (list, read, write, create, delete,
rename) and report problems with the same exceptions, so the API code in
app.py works unchanged with either. Pick one with MAPLENOTE_STORAGE (see
config.py).

Paths ("keys") are always relative, with / separators, like "ideas/todo.md".
Every path from the browser first goes through `canonical()`, which refuses
anything that would land outside the workspace (or outside the S3 prefix).

Versions: a file's version is a fingerprint of its contents (see
`version_of`). `write()` can be given the version the browser last saw, and
refuses with `Conflict` if the file has changed since, so a save never
silently overwrites changes made somewhere else.
"""
import hashlib
import os
import posixpath
import tempfile
import threading
from pathlib import Path


# ------------------------------------------------------------------ problems

class StorageError(Exception):
    """Base class: every problem a backend reports is one of these."""


class BadPath(StorageError):
    """The path is empty or malformed (400)."""


class OutsideWorkspace(StorageError):
    """The path would land outside the workspace (403)."""


class NotFound(StorageError):
    """There's no file at that path (404)."""


class AlreadyExists(StorageError):
    """Something already exists at that path (409)."""


class TooLarge(StorageError):
    """The file is bigger than the size limit (413)."""


class Conflict(StorageError):
    """The file changed since the browser last saw it (409)."""

    def __init__(self, current_version):
        super().__init__("The file was changed somewhere else.")
        self.current_version = current_version


def too_large_message(max_bytes):
    return f"File is larger than {max_bytes // (1024 * 1024)} MB."


def version_of(data):
    """A short fingerprint of a file's bytes: it changes whenever the contents do."""
    return hashlib.sha256(data).hexdigest()[:16]


def clean_key(rel_path):
    """Tidy a browser-supplied path into a key, without looking at any files.

    "a/./b/../c.txt" becomes "a/c.txt". Absolute paths and anything that
    climbs above the top ("../x") are refused.
    """
    if not rel_path:
        raise BadPath("No file path given.")
    if "\0" in rel_path:
        raise BadPath("That path isn't valid.")
    if rel_path.startswith("/"):
        raise OutsideWorkspace("That path is outside the workspace.")
    key = posixpath.normpath(rel_path)
    if key == "." or key == ".." or key.startswith("../"):
        raise OutsideWorkspace("That path is outside the workspace.")
    return key


def is_hidden(key):
    """Hidden files and folders start with '.', like .git or .secret."""
    return any(part.startswith(".") for part in key.split("/"))


# ---------------------------------------------------------------- local disk

class LocalStorage:
    """Files in one folder on this computer."""

    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        # The web server handles requests in parallel threads; this makes
        # "check the version, then write" one step that can't interleave.
        self._lock = threading.Lock()

    def describe(self):
        return f"folder {self.root}"

    def canonical(self, rel_path):
        """The key for a browser-supplied path, following symlinks.

        Refuses anything that would land outside the workspace, such as
        "../../etc/passwd" or a symlink pointing elsewhere.
        """
        target = (self.root / clean_key(rel_path)).resolve()
        if target == self.root or not target.is_relative_to(self.root):
            raise OutsideWorkspace("That path is outside the workspace.")
        return target.relative_to(self.root).as_posix()

    def _path(self, key):
        return self.root / key

    def list(self):
        keys = []
        for folder, subfolders, filenames in os.walk(self.root):
            # Editing this list in place tells os.walk not to descend into hidden folders.
            subfolders[:] = [name for name in subfolders if not name.startswith(".")]
            for name in filenames:
                if not name.startswith("."):
                    keys.append((Path(folder) / name).relative_to(self.root).as_posix())
        return keys

    def exists(self, key):
        return self._path(key).exists()

    def read(self, key, max_bytes=None):
        path = self._path(key)
        if not path.is_file():
            raise NotFound("File not found.")
        if max_bytes is not None and path.stat().st_size > max_bytes:
            raise TooLarge(too_large_message(max_bytes))
        return path.read_bytes()

    def version(self, key):
        return version_of(self.read(key))

    def write(self, key, data, base_version=None):
        path = self._path(key)
        with self._lock:
            # A file that no longer exists is simply created again.
            if base_version is not None and path.is_file():
                current = version_of(path.read_bytes())
                if current != base_version:
                    raise Conflict(current)
            path.parent.mkdir(parents=True, exist_ok=True)
            write_atomically(path, data)
        return version_of(data)

    def create(self, key):
        path = self._path(key)
        with self._lock:
            if path.exists():
                raise AlreadyExists(f"'{key}' already exists.")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()

    def delete(self, key):
        path = self._path(key)
        with self._lock:
            if not path.is_file():
                raise NotFound("File not found.")
            path.unlink()

    def rename(self, source_key, target_key):
        source, target = self._path(source_key), self._path(target_key)
        with self._lock:
            if not source.is_file():
                raise NotFound("File not found.")
            if target.exists():
                raise AlreadyExists(f"'{target_key}' already exists.")
            target.parent.mkdir(parents=True, exist_ok=True)
            source.rename(target)


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


# ------------------------------------------------------------------- AWS S3

class S3Storage:
    """Files as objects in an S3 bucket, optionally under a prefix ("folder").

    S3 has no real folders: "ideas/todo.md" is just an object whose name
    contains a slash. Two S3 features keep saves safe when several requests
    run at once (on Lambda, each may run on a different machine, so a lock
    in memory can't help):

      If-None-Match: *     "only write if nothing is there yet" (create, rename)
      If-Match: <ETag>     "only write if the object is still the one I read"

    S3 checks these itself and answers 412 (Precondition Failed) if they no
    longer hold, so two saves can never both win.

    Each object also stores its Maplenote version in its metadata, so
    checking a version needs only the object's headers, not its contents.
    """

    VERSION_KEY = "maplenote-version"

    def __init__(self, bucket, prefix="", client=None):
        if not bucket:
            raise ValueError("MAPLENOTE_S3_BUCKET must be set to use S3 storage.")
        if client is None:
            import boto3  # only needed for S3, so local use doesn't require it
            client = boto3.client("s3")
        from botocore.exceptions import ClientError
        self._ClientError = ClientError
        self.s3 = client
        self.bucket = bucket
        prefix = prefix.strip("/")
        self.prefix = f"{prefix}/" if prefix else ""

    def describe(self):
        return f"s3://{self.bucket}/{self.prefix}"

    def canonical(self, rel_path):
        # No symlinks in S3, so tidying the path is all it takes.
        return clean_key(rel_path)

    def _object(self, key):
        return self.prefix + key

    def _error_code(self, error):
        return error.response.get("Error", {}).get("Code", "")

    def _missing(self, error):
        return self._error_code(error) in ("404", "NoSuchKey", "NotFound")

    def _precondition_failed(self, error):
        return self._error_code(error) in ("412", "PreconditionFailed")

    def _head(self, key):
        """The object's headers, or None if there's no such object."""
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=self._object(key))
        except self._ClientError as error:
            if self._missing(error):
                return None
            raise

    def _get(self, key, max_bytes=None):
        """(contents, ETag) of the object, or raise NotFound / TooLarge."""
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=self._object(key))
        except self._ClientError as error:
            if self._missing(error):
                raise NotFound("File not found.") from error
            raise
        body = response["Body"]
        if max_bytes is not None and response["ContentLength"] > max_bytes:
            body.close()
            raise TooLarge(too_large_message(max_bytes))
        return body.read(), response["ETag"]

    def _put(self, key, data, **condition):
        self.s3.put_object(
            Bucket=self.bucket,
            Key=self._object(key),
            Body=data,
            ContentType="text/plain; charset=utf-8",
            Metadata={self.VERSION_KEY: version_of(data)},
            **condition,
        )

    def _version_and_etag(self, key):
        """(version, ETag) of the object, or (None, None) if it doesn't exist.

        Uses the stored version when there is one; an object uploaded some
        other way (the AWS console, the CLI) has none, so it's read instead.
        """
        head = self._head(key)
        if head is None:
            return None, None
        stored = head.get("Metadata", {}).get(self.VERSION_KEY)
        if stored:
            return stored, head["ETag"]
        data, etag = self._get(key)
        return version_of(data), etag

    def list(self):
        keys = []
        pages = self.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=self.prefix
        )
        for page in pages:
            for item in page.get("Contents", []):
                key = item["Key"][len(self.prefix):]
                # Keys ending in / are "folder" placeholders some tools create.
                if key and not key.endswith("/") and not is_hidden(key):
                    keys.append(key)
        return keys

    def exists(self, key):
        return self._head(key) is not None

    def read(self, key, max_bytes=None):
        return self._get(key, max_bytes)[0]

    def version(self, key):
        version, _ = self._version_and_etag(key)
        if version is None:
            raise NotFound("File not found.")
        return version

    def write(self, key, data, base_version=None):
        if base_version is None:
            self._put(key, data)
            return version_of(data)
        current, etag = self._version_and_etag(key)
        if current is not None and current != base_version:
            raise Conflict(current)
        # Write only if the object is still exactly what we just checked:
        # unchanged (If-Match), or still absent (If-None-Match).
        condition = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
        try:
            self._put(key, data, **condition)
        except self._ClientError as error:
            # Another save landed between our check and our write (412), or
            # the file was deleted in that moment (404). Report the file as
            # it is now.
            if self._precondition_failed(error) or self._missing(error):
                latest, _ = self._version_and_etag(key)
                raise Conflict(latest) from error
            raise
        return version_of(data)

    def create(self, key):
        try:
            self._put(key, b"", IfNoneMatch="*")
        except self._ClientError as error:
            if self._precondition_failed(error):
                raise AlreadyExists(f"'{key}' already exists.") from error
            raise

    def delete(self, key):
        if not self.exists(key):
            raise NotFound("File not found.")
        self.s3.delete_object(Bucket=self.bucket, Key=self._object(key))

    def rename(self, source_key, target_key):
        """S3 can't rename, so copy to the new name, then delete the old one."""
        data, _ = self._get(source_key)
        try:
            self._put(target_key, data, IfNoneMatch="*")
        except self._ClientError as error:
            if self._precondition_failed(error):
                raise AlreadyExists(f"'{target_key}' already exists.") from error
            raise
        self.s3.delete_object(Bucket=self.bucket, Key=self._object(source_key))


def from_config(config):
    """The backend chosen in config.py."""
    if config.STORAGE == "local":
        return LocalStorage(config.WORKSPACE)
    if config.STORAGE == "s3":
        return S3Storage(config.S3_BUCKET, config.S3_PREFIX)
    raise ValueError(f"Unknown MAPLENOTE_STORAGE '{config.STORAGE}': use 'local' or 's3'.")
