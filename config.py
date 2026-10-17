"""Settings for Maplenote.

Each setting can be overridden with an environment variable, for example:
    MAPLENOTE_WORKSPACE=~/Documents python app.py
"""
import os
from pathlib import Path

# The folder Maplenote reads and writes. It never touches anything outside it.
WORKSPACE = Path(os.environ.get("MAPLENOTE_WORKSPACE", "~/maplenote-files"))

# 127.0.0.1 means "only reachable from this computer".
HOST = os.environ.get("MAPLENOTE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MAPLENOTE_PORT", "8000"))

# Host names the browser may use to reach the server. Requests naming any other
# host are refused, which blocks malicious websites from tricking your browser
# into talking to Maplenote (an attack called "DNS rebinding").
# penguin.linux.test is the Chromebook's name for its Linux environment.
ALLOWED_HOSTS = os.environ.get(
    "MAPLENOTE_ALLOWED_HOSTS", "localhost,127.0.0.1,penguin.linux.test"
).split(",")

# Files bigger than this are refused, so a giant log can't freeze the browser tab.
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
