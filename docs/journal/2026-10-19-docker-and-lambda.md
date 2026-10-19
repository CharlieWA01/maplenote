# 2026-10-19: Docker image, password and deploy workflow for Lambda

## Goal
Package Maplenote as a Docker image that runs on AWS Lambda in the sandbox
account (and unchanged on a future homelab), deploy it from GitHub Actions
with no stored keys, and end up with a real URL Charlie can open. Cognito
login is a later step, so the URL needs some other protection meanwhile.

## What was done
- **`Dockerfile`**: `python:3.11-slim`, the app plus gunicorn and boto3
  (`requirements-image.txt`), and AWS's Lambda Web Adapter 1.1.0 in
  `/opt/extensions`. Runs as user 1000, writes nothing outside `/tmp` and
  `/data`. `.dockerignore` lets in only the files the image needs.
- **`MAPLENOTE_MAX_FILE_BYTES`**: the file-size limit is now a setting
  (5 MB on Lambda, which refuses payloads over about 6 MB).
- **Host names starting with a dot** in `MAPLENOTE_ALLOWED_HOSTS` allow any
  name ending with them. AWS picks the function URL's name, so the
  Terraform allows `.lambda-url.us-east-2.on.aws`.
- **`auth.py`**: one password for the whole app (HTTP Basic), checked
  against an scrypt hash in `MAPLENOTE_PASSWORD_HASH`. On Lambda the app
  refuses to start without the hash. See DECISIONS.md.
- **`deploy-sandbox` workflow**: signs in through the existing deploy role,
  builds and pushes the image tagged with the commit, updates the Lambda
  function, then checks from outside that the URL answers 401. Before the
  function exists it stops after the push with a notice.
- **`tests` workflow, new `image` job**: builds the image on every PR and
  runs it read-only and as non-root, with and without a password.
- `aws-sandbox-check` now uses `aws-actions/configure-aws-credentials@v6`
  (v5 ran on a Node.js version GitHub is retiring; v6 runs on Node 24).
- The AWS side (image repository, function, URL, permissions) is in
  `cloud-homelab`, `terraform/sandbox/maplenote-app.tf`, in its own PR.

## Problems and fixes
- **gunicorn 26 wants to write a "control socket"** in the user's home
  folder, which is read-only on Lambda: it logged `Read-only file system`
  at startup when the image was run with a read-only disk. Switched off with
  `--no-control-socket` (it's for managing gunicorn while it runs; not
  needed).
- **The password check is slow on purpose** (scrypt), and the browser sends
  the password with every request, including the editor's frequent change
  checks. The last accepted header is remembered, so only the first request
  (or a different password) pays for the full check.
- **A test that couldn't fail.** The first host-name test passed even with
  the "must start with a dot" rule removed, because none of its names
  happened to end with an allowed name. Added `evil-localhost`, which must be
  refused; it then failed without the rule, as it should.
- **Lambda needs an image before the function can exist**, and the image
  needs the repository. Resolved on the Terraform side with a targeted
  first apply (see `cloud-homelab`), and here by letting the workflow
  finish green after the push when the function isn't there yet.

## How it was verified
- `python -m pytest`: all API, storage and browser tests pass, including
  11 new ones (password on pages, scripts and API; wrong, empty and
  malformed passwords; username ignored; refusing to start on Lambda
  without a hash; size limit from the environment; host suffixes; a real
  Chromium signing in, editing and autosaving behind the password).
- Each new protection was broken on purpose and the tests failed: password
  check off (4 failed), the remembered header accepting anything (1), the
  Lambda start-up guard off (1), the leading-dot rule removed (1).
- The image was built and run locally with a read-only disk: it served the
  page, saved a file into a mounted folder as user 1000, answered 401
  without the password and 200 with it, and refused to start as "Lambda"
  without a hash. (The adapter itself couldn't be downloaded in Claude's
  session, so that local build used a stand-in; the `image` CI job builds
  the real one.)
- Not yet verified: the first real deploy, after Charlie's applies.

## Impact
Maplenote can be reached from anywhere at an HTTPS address, behind a
password, with notes in the private S3 bucket. Cost: cents a month (ECR
storage; Lambda requests stay in the free tier at one person's use).
Risk added: the app is on the public internet; the password, the fail-closed
start-up check and the deploy's 401 check are what keep it private.

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_
