"""Everyday editing: tabs, the sidebar, autosave, undo, find & replace."""
from playwright.sync_api import expect

from .helpers import editor_text, open_app, open_file, tab, type_at_end, wait_for_file


def test_first_visit_opens_the_scratch_pad(page, workspace):
    open_app(page)
    expect(page.locator(".tab")).to_have_count(1)
    expect(tab(page, "scratch.txt")).to_have_class("tab active pinned")
    # The scratch pad can't be renamed or deleted.
    expect(page.locator("#rename-button")).to_be_disabled()
    expect(page.locator("#delete-button")).to_be_disabled()


def test_sidebar_opens_files_in_tabs(page, workspace):
    (workspace / "notes").mkdir()
    (workspace / "notes" / "a.md").write_text("# A\n")
    (workspace / "top.txt").write_text("top\n")
    open_app(page)

    open_file(page, "notes/a.md")
    assert editor_text(page) == "# A\n"
    open_file(page, "top.txt")
    assert editor_text(page) == "top\n"
    expect(page.locator(".tab-name")).to_have_text(["scratch.txt", "a.md", "top.txt"])


def test_autosave_writes_to_disk_and_clears_the_dot(page, workspace):
    (workspace / "notes.txt").write_text("notes\n")
    open_app(page)
    open_file(page, "notes.txt")

    type_at_end(page, "typed")
    expect(tab(page, "notes.txt")).to_contain_class("dirty")
    wait_for_file(workspace / "notes.txt", "notes\ntyped")
    expect(tab(page, "notes.txt")).not_to_contain_class("dirty")


def test_open_tabs_come_back_after_a_refresh(page, workspace):
    (workspace / "a.txt").write_text("a")
    (workspace / "b.txt").write_text("b")
    open_app(page)
    open_file(page, "a.txt")
    open_file(page, "b.txt")

    page.reload()

    expect(page.locator(".tab-name")).to_have_text(["scratch.txt", "a.txt", "b.txt"])
    expect(page.locator(".tab.active")).to_have_attribute("title", "b.txt")


def test_undo_and_redo_survive_switching_tabs(page, workspace):
    (workspace / "a.txt").write_text("start\n")
    open_app(page)
    open_file(page, "a.txt")
    type_at_end(page, "added")

    tab(page, "scratch.txt").click()
    tab(page, "a.txt").click()
    page.click(".cm-content")
    page.keyboard.press("Control+z")
    assert editor_text(page) == "start\n"
    page.keyboard.press("Control+y")
    assert editor_text(page) == "start\nadded"


def test_undoing_back_to_the_saved_text_makes_the_tab_clean(page, workspace):
    (workspace / "a.txt").write_text("saved")
    open_app(page)
    page.locator("#autosave-toggle").click()  # off, so the edit stays unsaved
    open_file(page, "a.txt")

    type_at_end(page, "!")
    expect(tab(page, "a.txt")).to_contain_class("dirty")
    page.keyboard.press("Control+z")
    expect(tab(page, "a.txt")).not_to_contain_class("dirty")


def test_new_rename_and_delete(page, workspace):
    open_app(page)
    page.once("dialog", lambda dialog: dialog.accept("ideas/todo.md"))
    page.click("#new-button")
    expect(page.locator(".tab.active")).to_have_attribute("title", "ideas/todo.md")
    assert (workspace / "ideas" / "todo.md").exists()

    page.once("dialog", lambda dialog: dialog.accept("ideas/done.md"))
    page.click("#rename-button")
    expect(page.locator(".tab.active")).to_have_attribute("title", "ideas/done.md")
    assert (workspace / "ideas" / "done.md").exists()
    assert not (workspace / "ideas" / "todo.md").exists()

    page.once("dialog", lambda dialog: dialog.accept())  # "Delete …? This can't be undone."
    page.click("#delete-button")
    expect(page.locator(".tab")).to_have_count(1)
    assert not (workspace / "ideas" / "done.md").exists()


def test_deleting_with_a_pending_autosave_does_not_bring_the_file_back(page, workspace):
    (workspace / "a.txt").write_text("a")
    open_app(page)
    open_file(page, "a.txt")
    type_at_end(page, "x")  # autosave is now due in about a second

    page.once("dialog", lambda dialog: dialog.accept())
    page.click("#delete-button")
    page.wait_for_timeout(1500)

    assert not (workspace / "a.txt").exists()


def test_find_and_replace_all_can_be_undone(page, workspace):
    (workspace / "a.txt").write_text("The fox and the dog.\n")
    open_app(page)
    open_file(page, "a.txt")

    page.click("#find-button")
    page.keyboard.type("the")
    page.fill(".cm-search input[name=replace]", "a")
    page.click(".cm-search button[name=replaceAll]")
    assert editor_text(page) == "a fox and a dog.\n"

    page.click(".cm-content")
    page.keyboard.press("Control+z")
    assert editor_text(page) == "The fox and the dog.\n"


def test_status_bar_counts_and_word_wrap_setting(page, workspace):
    (workspace / "a.txt").write_text("one two three\nfour\n")
    open_app(page)
    open_file(page, "a.txt")

    expect(page.locator("#count-info")).to_have_text("4 words · 3 lines")
    expect(page.locator("#cursor-info")).to_have_text("Ln 1, Col 1")

    wrap = page.locator("#wrap-toggle")
    expect(wrap).to_be_checked()
    wrap.click()
    page.reload()
    expect(page.locator("#wrap-toggle")).not_to_be_checked()  # remembered
