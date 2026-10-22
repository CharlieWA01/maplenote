"""The password that protects a hosted Maplenote (auth.py), in a real browser.

Chromium signs in on the sign-in page the way a person does, and must then
keep sending its session cookie with every script, style and API call.
"""
import hashlib

import pytest
from playwright.sync_api import expect
from werkzeug.security import generate_password_hash

import auth
import config

from .helpers import open_app, set_autosave, type_at_end, wait_for_file

PASSWORD = "correct horse battery"

# What's left in the browser's "maplenote" database (drafts, device file handles).
STORE_KEYS = """async (name) => {
    const db = await new Promise((resolve) => {
        const request = indexedDB.open("maplenote", 2);
        request.onsuccess = () => resolve(request.result);
    });
    return new Promise((resolve) => {
        const request = db.transaction(name).objectStore(name).getAllKeys();
        request.onsuccess = () => resolve(request.result);
    });
}"""
DRAFT_KEYS = f"() => ({STORE_KEYS})('drafts')"


@pytest.fixture(autouse=True)
def password_on(monkeypatch):
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash(PASSWORD))
    monkeypatch.setattr(auth, "_last_accepted", None)


def sign_in(page, password):
    page.goto("/login")
    page.fill("#password", password)
    page.click("button[type=submit]")


def test_sign_in_then_edit_and_save(page, workspace):
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    expect(page.locator("#guest-bar")).to_be_hidden()
    type_at_end(page, "typed behind a password")
    wait_for_file(workspace / "scratch.txt", "typed behind a password")
    # Still signed in after a reload (the cookie is kept).
    open_app(page)


def test_every_request_with_a_body_carries_its_hash(page, workspace):
    """Behind CloudFront in production, AWS refuses a PUT or POST to the function
    unless x-amz-content-sha256 matches its body (origin access control). So
    signing in, saving, creating, renaming and deleting must all send it."""
    sent = []
    page.on("request", lambda request: request.method != "GET" and sent.append(request))
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    type_at_end(page, "hashed")
    wait_for_file(workspace / "scratch.txt", "hashed")
    page.once("dialog", lambda dialog: dialog.accept("new.txt"))
    page.click("#new-button")
    expect(page.locator(".tab.active .tab-name")).to_have_text("new.txt")
    page.once("dialog", lambda dialog: dialog.accept())
    page.click("#delete-button")
    expect(page.locator('.file-item[title="new.txt"]')).to_have_count(0)

    methods = sorted({(r.method, r.url.split("?")[0].rsplit("/", 2)[-1]) for r in sent})
    assert methods == [("DELETE", "file"), ("POST", "file"), ("POST", "login"), ("PUT", "file")]
    for request in sent:
        body = request.post_data_buffer or b""
        assert request.headers.get("x-amz-content-sha256") == hashlib.sha256(body).hexdigest(), request.url


def test_wrong_password_stays_on_the_sign_in_page(page):
    sign_in(page, "wrong horse")
    expect(page.locator(".login-error")).to_contain_text("isn't right")
    expect(page.locator(".tab")).to_have_count(0)


def test_signing_out_returns_to_the_sign_in_page(page):
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    page.goto("/logout")
    expect(page.locator("#password")).to_be_visible()
    # Signed out, the page opens in guest mode.
    page.goto("/")
    expect(page.locator("#guest-bar")).to_be_visible()


def test_sign_out_button_saves_then_leaves_nothing_behind(page, workspace):
    """Signing out saves your work, then removes this browser's drafts and list of
    open tabs, so the next person at a shared computer finds none of your notes."""
    (workspace / "notes.txt").write_text("")
    sign_in(page, PASSWORD)
    expect(page.locator("#sign-out-button")).to_be_visible()
    page.click('.file-item[title="notes.txt"]')
    set_autosave(page, False)
    type_at_end(page, "saved on the way out")
    page.evaluate("storeDraft(activeTab)")  # as if a draft had been kept

    page.click("#sign-out-button")

    expect(page.locator("#password")).to_be_visible()
    assert (workspace / "notes.txt").read_text() == "saved on the way out"
    assert page.evaluate(DRAFT_KEYS) == []
    assert page.evaluate(STORE_KEYS, "handles") == []
    assert page.evaluate("localStorage.getItem('maplenote.session')") is None


def test_sign_out_asks_before_losing_changes_it_cannot_save(page, workspace):
    (workspace / "notes.txt").write_text("")
    sign_in(page, PASSWORD)
    page.click('.file-item[title="notes.txt"]')
    set_autosave(page, False)
    type_at_end(page, "mine")
    (workspace / "notes.txt").write_text("changed elsewhere")  # so the save is refused

    messages = []
    page.once("dialog", lambda dialog: (messages.append(dialog.message), dialog.dismiss()))
    page.click("#sign-out-button")

    expect(page.locator("#banner")).to_contain_text("was changed somewhere else")
    assert "notes.txt" in messages[0]
    expect(page.locator(".tab")).to_have_count(2)  # still signed in, nothing lost


def test_sign_out_anyway_removes_the_draft_of_the_lost_changes(page, workspace):
    (workspace / "notes.txt").write_text("")
    sign_in(page, PASSWORD)
    page.click('.file-item[title="notes.txt"]')
    set_autosave(page, False)
    type_at_end(page, "mine")
    page.evaluate("storeDraft(activeTab)")  # as if a draft had been kept
    (workspace / "notes.txt").write_text("changed elsewhere")

    page.once("dialog", lambda dialog: dialog.accept())  # "Sign out anyway?"
    page.click("#sign-out-button")

    expect(page.locator("#password")).to_be_visible()
    assert page.evaluate(DRAFT_KEYS) == []  # the unsaved draft went too


def test_page_goes_to_sign_in_when_the_session_ends(page, context):
    """An API call refused mid-session (cookie gone) sends the page to sign in."""
    sign_in(page, PASSWORD)
    expect(page.locator(".tab")).not_to_have_count(0)
    context.clear_cookies()
    type_at_end(page, "x")  # autosave calls the server
    expect(page.locator("#password")).to_be_visible(timeout=5000)
