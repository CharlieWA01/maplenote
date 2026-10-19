"""The password that protects a hosted Maplenote (auth.py), in a real browser.

Chromium signs in on the sign-in page the way a person does, and must then
keep sending its session cookie with every script, style and API call.
"""
import pytest
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


def sign_in(page, password):
    page.goto("/")
    expect(page.locator("#password")).to_be_visible()  # sent to the sign-in page
    page.fill("#password", password)
    page.click("button[type=submit]")


def test_sign_in_then_edit_and_save(page, workspace):
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    type_at_end(page, "typed behind a password")
    wait_for_file(workspace / "scratch.txt", "typed behind a password")
    # Still signed in after a reload (the cookie is kept).
    open_app(page)


def test_wrong_password_stays_on_the_sign_in_page(page):
    sign_in(page, "wrong horse")
    expect(page.locator(".login-error")).to_contain_text("isn't right")
    expect(page.locator(".tab")).to_have_count(0)


def test_signing_out_returns_to_the_sign_in_page(page):
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    page.goto("/logout")
    expect(page.locator("#password")).to_be_visible()
    page.goto("/")
    expect(page.locator("#password")).to_be_visible()


def test_page_goes_to_sign_in_when_the_session_ends(page, context):
    """An API call refused mid-session (cookie gone) sends the page to sign in."""
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    context.clear_cookies()
    type_at_end(page, "x")  # autosave calls the server
    expect(page.locator("#password")).to_be_visible(timeout=5000)
