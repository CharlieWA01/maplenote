"""The password that protects a hosted Maplenote (auth.py), in a real browser.

Chromium is given the password the way a person types it into the sign-in
box, and must then keep sending it with every script, style and API call.
"""
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect
from werkzeug.security import generate_password_hash

import auth
import config

from .helpers import open_app, type_at_end, wait_for_file

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def password_on(monkeypatch):
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash(PASSWORD))
    monkeypatch.setattr(auth, "_last_accepted", None)


@pytest.fixture
def browser_context_args(browser_context_args):
    """Answers the browser's sign-in box with the password."""
    return {**browser_context_args, "http_credentials": {"username": "charlie", "password": PASSWORD}}


def test_signed_in_browser_can_edit_and_save(page, workspace):
    open_app(page)
    type_at_end(page, "typed behind a password")
    wait_for_file(workspace / "scratch.txt", "typed behind a password")


def test_without_the_password_nothing_loads(browser, base_url):
    context = browser.new_context(base_url=base_url)
    page = context.new_page()
    # With nobody to answer the sign-in box, headless Chromium either shows
    # the 401 page or gives up on the navigation, depending on its mode.
    try:
        assert page.goto("/").status == 401
    except PlaywrightError as error:
        assert "ERR_INVALID_AUTH_CREDENTIALS" in str(error)
    expect(page.locator(".tab")).to_have_count(0)
    context.close()
