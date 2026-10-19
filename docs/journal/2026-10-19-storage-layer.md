# 2026-10-19: The storage layer (local folder or S3)

## Goal
Move all file access in the server behind one interface, with a backend for
the local folder (today) and one for Amazon S3 (when hosted on AWS), keeping
every safety rule and the conflict check working on both. No real AWS yet:
that's being prepared in `cloud-homelab` (Phase 2) at the same time.

## What was done
- **`storage.py`**, new:
  - `LocalStorage`: the old disk code moved out of `app.py` unchanged
    (path checks that follow symlinks, atomic writes), plus a lock so
    "check the version, then write" can't interleave between two requests.
  - `S3Storage`: the same operations on S3 objects with boto3. Saves use
    S3 conditional writes: `If-Match` with the object's ETag, so the write
    only happens if nobody changed the file since it was checked, and
    `If-None-Match: *` for creating files and the target of a rename. The
    Maplenote version is stored in each object's metadata, so change checks
    only read headers. An optional prefix keeps Maplenote's files in one
    "folder" of a bucket.
  - Shared exceptions (`NotFound`, `AlreadyExists`, `Conflict`,
    `OutsideWorkspace`, …) with readable messages.
- **`app.py`** now only handles HTTP: it turns paths into keys, calls the
  backend, and maps the exceptions to status codes (404, 409, 403, …). It
  shrank by about 40 lines.
- **`config.py`**: `MAPLENOTE_STORAGE` (`local` or `s3`),
  `MAPLENOTE_S3_BUCKET`, `MAPLENOTE_S3_PREFIX`. AWS credentials are never a
  Maplenote setting; on Lambda they come from the function's role.
- **`tests/test_storage.py`**, new: 42 tests. The same contract tests run
  against both backends; S3 runs on moto, a fake S3 in memory. S3-only tests
  simulate two saves racing on different machines, files uploaded from the
  AWS console, and prefixes. One test runs the whole API on S3.
- `requirements-dev.txt`: boto3 1.43.103 and moto 5.2.3 (both a few weeks
  old, per the vendoring rule of preferring settled releases).

## Problems and fixes
- moto refuses the bucket name `b` (too short for real S3 rules too); the
  tests use `maplenote-test`.
- Before writing the S3 code, a quick check confirmed moto implements
  conditional writes (412 on `If-Match` with a stale ETag and on
  `If-None-Match: *` when the object exists), so the race tests prove
  something real.

## How it was verified
- Full suite: 104 tests pass (27 API, 42 storage, 35 browser). The existing
  API and browser tests didn't change, which shows the refactor kept the
  behaviour.
- **Sabotage check:** removing the S3 write condition made both race tests
  fail; removing hidden-file filtering in S3 made its listing test fail;
  disabling the local conflict check failed 2 tests. Each was restored.
- Not yet verified against real S3; that happens once the sandbox bucket
  exists.

## Impact
- Switching to S3 later is a setting, not a code change.
- No new packages needed to run Maplenote locally.
- New limitation: on S3, rename is copy-then-delete.
