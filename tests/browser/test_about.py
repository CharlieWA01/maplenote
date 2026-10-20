"""The About box: the version number in the status bar opens it, with the
build the app is running and the changelog. It reads only static files, so
it must work the same for a guest, without calling the files API."""
import re
from pathlib import Path

import pytest
from playwright.sync_api import expect
from werkzeug.security import generate_password_hash

import auth
import config

from .helpers import open_app

STATIC = Path(__file__).resolve().parents[2] / "static"
CHANGELOG = (STATIC / "changelog.md").read_text(encoding="utf-8")
VERSION = re.search(r"^## (\d+\.\d+\.\d+)", CHANGELOG, re.M).group(1)
ENTRIES = len(re.findall(r"^## ", CHANGELOG, re.M))


@pytest.fixture
def build_record():
    """A build record like the one the Dockerfile writes into the image."""
    path = STATIC / "build.json"
    path.write_text('{"commit": "0123456789abcdef0123456789abcdef01234567", "built": "2026-10-20 01:02 UTC"}\n')
    yield
    path.unlink()


def open_about(page):
    expect(page.locator("#about-button")).to_have_text(f"v{VERSION}")
    page.click("#about-button")
    dialog = page.locator("#about-dialog")
    expect(dialog).to_be_visible()
    return dialog


def test_status_bar_shows_the_version_and_opens_the_changelog(page):
    open_app(page)
    dialog = open_about(page)
    expect(dialog.locator("h2#about-title")).to_have_text(f"Maplenote {VERSION}")
    # Every changelog entry, newest first, without the file's own intro.
    expect(dialog.locator("#changelog h2")).to_have_count(ENTRIES)
    expect(dialog.locator("#changelog h2").first).to_contain_text(VERSION)
    expect(dialog.locator("#changelog h1")).to_have_count(0)
    # Running from the source folder there's no build record.
    expect(dialog.locator("#about-build")).to_have_text("Running from the source folder, not a built image.")
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()


def test_a_built_image_shows_its_commit_and_build_time(page, build_record):
    open_app(page)
    dialog = open_about(page)
    expect(dialog.locator("#about-build")).to_have_text("Built from commit 0123456 on 2026-10-20 01:02 UTC.")
    dialog.get_by_role("button", name="Close").click()
    expect(dialog).to_be_hidden()


def test_guests_see_it_too_without_calling_the_files_api(page, context, monkeypatch, build_record):
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash("correct horse battery"))
    monkeypatch.setattr(auth, "_last_accepted", None)
    api_calls = []
    context.on("request", lambda request: "/api/" in request.url and api_calls.append(request.url))
    page.goto("/")
    expect(page.locator("#guest-bar")).to_be_visible()
    dialog = open_about(page)
    expect(dialog.locator("#changelog h2")).to_have_count(ENTRIES)
    expect(dialog.locator("#about-build")).to_contain_text("Built from commit 0123456")
    assert api_calls == []
