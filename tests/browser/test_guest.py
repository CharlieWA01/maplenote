"""Guest mode: a visitor who isn't signed in, with notes kept in their browser.

The app runs with a password (as on AWS) and the browser never signs in. A
guest must get a working editor, and must never reach the files API, so
every test also checks that no request went to /api/.
"""
import re
import zipfile

import pytest
from playwright.sync_api import expect
from werkzeug.security import generate_password_hash

import auth
import config

from .helpers import editor_text, set_autosave, tab, type_at_end


@pytest.fixture(autouse=True)
def password_on(monkeypatch):
    monkeypatch.setattr(config, "PASSWORD_HASH", generate_password_hash("correct horse battery"))
    monkeypatch.setattr(auth, "_last_accepted", None)


@pytest.fixture
def api_calls(context):
    """Every request any page in the test makes to the files API (there must be none)."""
    calls = []
    context.on("request", lambda request: "/api/" in request.url and calls.append(request.url))
    yield calls
    assert calls == []


def open_as_guest(page):
    page.goto("/")
    expect(page.locator("#guest-bar")).to_be_visible()
    expect(tab(page, "scratch.txt")).to_be_visible()


def open_note(page, path):
    page.click(f'.file-item[title="{path}"]')
    expect(page.locator(".tab.active")).to_have_attribute("title", f"{path} (saved in this browser)")


def wait_for_draft_and_save(page):
    """Autosave runs about a second after typing stops."""
    expect(page.locator("#status")).to_contain_text("Saved ✓", timeout=5000)


def test_first_visit_opens_on_the_welcome_note(page, api_calls, workspace):
    open_as_guest(page)
    expect(page.locator(".tab")).to_have_count(2)  # the scratch pad, then the welcome note
    expect(page.locator(".tab.active")).to_have_attribute("title", "Welcome.md (saved in this browser)")
    expect(page.locator("#preview h1")).to_have_text("Welcome to Maplenote")
    expect(page.locator("#guest-bar a")).to_have_attribute("href", "/login")
    # Nothing was made on the server.
    assert sorted(p.name for p in workspace.iterdir()) == []


def test_notes_are_saved_in_the_browser_and_survive_a_reload(page, api_calls, workspace):
    open_as_guest(page)
    tab(page, "scratch.txt").click()
    type_at_end(page, "a guest's note")
    wait_for_draft_and_save(page)

    page.reload()
    expect(page.locator("#guest-bar")).to_be_visible()
    tab(page, "scratch.txt").click()
    assert editor_text(page) == "a guest's note"
    assert not (workspace / "scratch.txt").exists()


def test_new_rename_and_delete(page, api_calls):
    open_as_guest(page)
    page.once("dialog", lambda dialog: dialog.accept("ideas/./todo.md"))
    page.click("#new-button")
    expect(page.locator(".tab.active .tab-name")).to_have_text("todo.md")
    expect(page.locator('.file-item[title="ideas/todo.md"]')).to_be_visible()  # path tidied

    page.once("dialog", lambda dialog: dialog.accept("ideas/done.md"))
    page.click("#rename-button")
    expect(page.locator('.file-item[title="ideas/done.md"]')).to_be_visible()
    expect(page.locator('.file-item[title="ideas/todo.md"]')).to_have_count(0)

    page.once("dialog", lambda dialog: dialog.accept())  # "Delete …? This can't be undone."
    page.click("#delete-button")
    expect(page.locator('.file-item[title="ideas/done.md"]')).to_have_count(0)


def test_deleted_welcome_note_does_not_come_back(page, api_calls):
    open_as_guest(page)
    page.once("dialog", lambda dialog: dialog.accept())
    page.click("#delete-button")  # the welcome note is the active tab
    expect(page.locator('.file-item[title="Welcome.md"]')).to_have_count(0)

    page.reload()
    expect(page.locator("#guest-bar")).to_be_visible()
    expect(page.locator(".tab")).to_have_count(1)
    expect(page.locator('.file-item[title="Welcome.md"]')).to_have_count(0)


def test_browser_notes_keep_the_servers_rules(page, api_calls):
    """The same rules as the server, enforced below the buttons (not just by hiding them)."""
    open_as_guest(page)
    statuses = page.evaluate("""async () => {
        const status = (promise) => promise.then(() => "ok", (error) => error.status);
        return {
            deleteScratch: await status(notes.remove("scratch.txt")),
            renameScratch: await status(notes.rename("scratch.txt", "x.txt")),
            renameOntoTaken: await status(notes.rename("Welcome.md", "scratch.txt")),
            createTaken: await status(notes.create("Welcome.md")),
            climbOut: await status(notes.create("../x.txt")),
            absolute: await status(notes.create("/x.txt")),
            missing: await status(notes.read("nope.txt")),
            tooBig: await status(notes.save("big.txt", "x".repeat(5 * 1024 * 1024 + 1))),
        };
    }""")
    assert statuses == {
        "deleteScratch": 403, "renameScratch": 403, "renameOntoTaken": 409, "createTaken": 409,
        "climbOut": 403, "absolute": 403, "missing": 404, "tooBig": 413,
    }
    # The refused rename left both notes as they were.
    files = page.evaluate("notes.list().then((list) => list.files)")
    assert files == ["scratch.txt", "Welcome.md"]


def test_a_change_in_another_browser_tab_is_never_overwritten(context, api_calls):
    first, second = context.new_page(), context.new_page()
    for page in (first, second):
        open_as_guest(page)
        open_note(page, "scratch.txt")
    type_at_end(second, "from the second tab")
    wait_for_draft_and_save(second)

    type_at_end(first, "from the first tab")
    expect(first.locator("#banner")).to_contain_text("was changed somewhere else", timeout=5000)
    first.click("#banner >> text=Save mine as a copy")

    expect(first.locator("#banner")).to_be_hidden()
    assert editor_text(first) == "from the second tab"
    open_note(first, "scratch (conflict).txt")
    assert editor_text(first) == "from the first tab"


def test_download_all_notes_as_a_zip(page, api_calls):
    """A guest can keep their notes: one .zip, folders and unsaved edits included."""
    open_as_guest(page)
    page.once("dialog", lambda dialog: dialog.accept("ideas/café.md"))
    page.click("#new-button")
    expect(page.locator(".tab.active .tab-name")).to_have_text("café.md")
    set_autosave(page, False)
    type_at_end(page, "not saved yet ✓")

    with page.expect_download() as download:
        page.click("#download-notes-button")

    assert re.fullmatch(r"maplenote-notes-\d{4}-\d{2}-\d{2}\.zip", download.value.suggested_filename)
    with zipfile.ZipFile(download.value.path()) as archive:
        assert archive.testzip() is None  # every checksum is right
        assert sorted(archive.namelist()) == ["Welcome.md", "ideas/café.md", "scratch.txt"]
        assert archive.read("ideas/café.md").decode() == "not saved yet ✓"
        assert archive.read("Welcome.md").decode().startswith("# Welcome to Maplenote")
    expect(page.locator("#status")).to_have_text("Downloaded 3 notes as a .zip")


def test_guests_are_not_offered_sign_out(page, api_calls):
    open_as_guest(page)
    expect(page.locator("#sign-out-button")).to_be_hidden()


def test_signed_in_mode_is_unchanged_locally(page, monkeypatch, workspace):
    """Without a password (on your own computer) there's no guest mode."""
    monkeypatch.setattr(config, "PASSWORD_HASH", "")
    page.goto("/")
    expect(tab(page, "scratch.txt")).to_be_visible()
    expect(page.locator("#guest-bar")).to_be_hidden()
    assert (workspace / "scratch.txt").exists()  # the server's scratch pad
