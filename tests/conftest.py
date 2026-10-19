"""Shared setup for all tests.

app.py reads its settings when it's first imported, so the workspace folder
is chosen here, before anything imports it. Every test then starts with that
folder emptied.

Browser tests use one copy of the app, running in a background thread for the
whole test session, and a fresh browser profile (no saved tabs, drafts or
settings) for each test, courtesy of pytest-playwright's `page` fixture.
"""
import os
import shutil
import tempfile
import threading
from pathlib import Path

import pytest
from werkzeug.serving import make_server

WORKSPACE = Path(tempfile.mkdtemp(prefix="maplenote-test-"))
os.environ["MAPLENOTE_WORKSPACE"] = str(WORKSPACE)

import app as maplenote  # noqa: E402  (must come after the environment is set)


@pytest.fixture(autouse=True)
def workspace():
    """An empty workspace folder for each test."""
    for child in WORKSPACE.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    return WORKSPACE


@pytest.fixture
def client():
    """Flask's built-in test client: calls the API without a real server."""
    return maplenote.app.test_client()


@pytest.fixture(scope="session")
def base_url():
    """Run the app on a free port for the browser tests; pages open relative to it."""
    server = make_server("127.0.0.1", 0, maplenote.app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://localhost:{server.server_port}"
    server.shutdown()


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    """Use a specific Chromium if MAPLENOTE_TEST_CHROMIUM points at one.

    GitHub Actions installs the browser that matches Playwright, so it doesn't
    need this; Claude's cloud sessions have a preinstalled Chromium instead.
    """
    path = os.environ.get("MAPLENOTE_TEST_CHROMIUM")
    return {**browser_type_launch_args, **({"executable_path": path} if path else {})}
