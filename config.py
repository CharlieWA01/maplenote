"""Settings for Maplenote.

Each setting can be overridden with an environment variable, for example:
    MAPLENOTE_WORKSPACE=~/Documents python app.py
"""
import os
from pathlib import Path

# Where files live: "local" (a folder on this computer) or "s3" (an Amazon S3
# bucket, for when Maplenote is hosted on AWS). See storage.py.
STORAGE = os.environ.get("MAPLENOTE_STORAGE", "local")

# For "local": the folder Maplenote reads and writes. It never touches anything outside it.
WORKSPACE = Path(os.environ.get("MAPLENOTE_WORKSPACE", "~/maplenote-files"))

# For "s3": the bucket, and optionally a prefix ("folder") inside it, such as
# "notes". The AWS region and credentials come from the usual AWS settings
# (on Lambda, from the function's role; never stored here).
S3_BUCKET = os.environ.get("MAPLENOTE_S3_BUCKET", "")
S3_PREFIX = os.environ.get("MAPLENOTE_S3_PREFIX", "")

# The always-open scratch pad, relative to the workspace. Created if missing.
SCRATCH_FILE = "scratch.txt"

# 127.0.0.1 means "only reachable from this computer".
HOST = os.environ.get("MAPLENOTE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MAPLENOTE_PORT", "8000"))

# Host names the browser may use to reach the server. Requests naming any other
# host are refused, which blocks malicious websites from tricking your browser
# into talking to Maplenote (an attack called "DNS rebinding").
# penguin.linux.test is the Chromebook's name for its Linux environment.
# A name starting with a dot allows every name ending with it: on AWS,
# ".lambda-url.us-east-2.on.aws" allows the function's own web address
# (AWS chooses it, so it isn't known in advance).
ALLOWED_HOSTS = os.environ.get(
    "MAPLENOTE_ALLOWED_HOSTS", "localhost,127.0.0.1,penguin.linux.test"
).split(",")

# Files bigger than this are refused, so a giant log can't freeze the browser tab.
# 10 MB by default. On AWS Lambda it's set to 5 MB, because Lambda refuses
# requests and responses over about 6 MB.
MAX_FILE_BYTES = int(os.environ.get("MAPLENOTE_MAX_FILE_BYTES", 10 * 1024 * 1024))

# When set, every request must carry this password (see auth.py). Holds a hash
# of the password, made with `python auth.py`, never the password itself.
# Empty (no password) is the normal case on your own computer.
PASSWORD_HASH = os.environ.get("MAPLENOTE_PASSWORD_HASH", "")

# AWS sets this on Lambda. Maplenote refuses to start there without a
# password, so a missing setting can't put the notes online unprotected.
ON_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
