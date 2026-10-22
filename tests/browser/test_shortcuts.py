"""Keyboard shortcuts: Ctrl+S saves, Alt+W closes a tab, Ctrl+E switches Edit/Preview."""
from playwright.sync_api import expect

from .helpers import open_app, open_file, set_autosave, tab, type_at_end


def test_ctrl_s_saves_with_autosave_off(page, workspace):
    (workspace / "notes.txt").write_text("")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "notes.txt")
    type_at_end(page, "saved by keyboard")
    page.wait_for_timeout(1500)  # autosave would have run by now
    assert (workspace / "notes.txt").read_text() == ""

    page.keyboard.press("Control+s")

    expect(page.locator("#status")).to_contain_text("Saved ✓")
    assert (workspace / "notes.txt").read_text() == "saved by keyboard"
    expect(tab(page, "notes.txt")).not_to_contain_class("dirty")


def test_alt_w_closes_the_tab_but_not_the_scratch_pad(page, workspace):
    (workspace / "notes.txt").write_text("hi")
    open_app(page)
    open_file(page, "notes.txt")
    expect(page.locator(".tab")).to_have_count(2)

    page.keyboard.press("Alt+w")
    expect(page.locator(".tab")).to_have_count(1)
    expect(page.locator(".tab.active")).to_have_attribute("title", "scratch.txt")

    page.keyboard.press("Alt+w")
    expect(page.locator(".tab")).to_have_count(1)
    expect(page.locator("#status")).to_have_text("The scratch pad stays open.")


def test_alt_w_still_asks_about_unsaved_changes(page, workspace):
    (workspace / "notes.txt").write_text("")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "notes.txt")
    type_at_end(page, "not saved yet")

    page.keyboard.press("Alt+w")

    expect(page.locator("#unsaved-dialog")).to_be_visible()
    page.click("#unsaved-dialog >> text=Cancel")
    expect(page.locator(".tab")).to_have_count(2)


def test_ctrl_e_switches_markdown_between_edit_and_preview(page, workspace):
    (workspace / "notes.md").write_text("# A heading\n")
    open_app(page)
    open_file(page, "notes.md")
    page.click(".cm-content")

    page.keyboard.press("Control+e")
    expect(page.locator("#preview h1")).to_have_text("A heading")
    expect(page.locator("#preview-mode-button")).to_have_attribute("aria-pressed", "true")

    page.keyboard.press("Control+e")
    expect(page.locator("#preview")).to_be_hidden()
    expect(page.locator(".cm-content")).to_be_focused()


def test_sign_out_is_not_offered_locally(page):
    """No password on your own computer, so nothing to sign out of."""
    open_app(page)
    expect(page.locator("#sign-out-button")).to_be_hidden()
