"""Not losing work: conflicts, crash recovery and the unsaved-changes dialog."""
import pytest
from playwright.sync_api import expect

from .helpers import editor_text, open_app, open_file, set_autosave, tab, type_at_end, wait_for_file

# Drafts are kept about a second after typing stops; wait comfortably longer so
# slower machines (like GitHub's) have stored it before the page reloads.
DRAFT_DELAY = 2000


@pytest.fixture
def two_tabs(context, workspace):
    """The same file open in two browser tabs: the classic conflict setup."""
    (workspace / "todo.md").write_text("- milk\n")
    first, second = context.new_page(), context.new_page()
    for page in (first, second):
        open_app(page)
        open_file(page, "todo.md")
    return first, second


def make_conflict(first, second, workspace):
    """Tab B adds eggs and saves; then tab A adds bread and tries to save."""
    type_at_end(second, "- eggs\n")
    wait_for_file(workspace / "todo.md", "- milk\n- eggs\n")
    type_at_end(first, "- bread\n")
    expect(first.locator("#banner")).to_contain_text("was changed somewhere else", timeout=5000)


def test_conflict_never_overwrites_the_other_change(two_tabs, workspace):
    first, second = two_tabs
    make_conflict(first, second, workspace)

    expect(tab(first, "todo.md")).to_contain_class("conflict")
    first.wait_for_timeout(1500)  # autosave would have run by now
    assert (workspace / "todo.md").read_text() == "- milk\n- eggs\n"


def test_conflict_save_mine_as_a_copy(two_tabs, workspace):
    first, second = two_tabs
    make_conflict(first, second, workspace)

    first.click("#banner >> text=Save mine as a copy")

    expect(first.locator("#banner")).to_be_hidden()
    assert (workspace / "todo (conflict).md").read_text() == "- milk\n- bread\n"
    assert editor_text(first) == "- milk\n- eggs\n"


def test_conflict_keep_mine(two_tabs, workspace):
    first, second = two_tabs
    make_conflict(first, second, workspace)

    first.click("#banner >> text=Keep mine")

    wait_for_file(workspace / "todo.md", "- milk\n- bread\n")


def test_conflict_load_their_version(two_tabs, workspace):
    first, second = two_tabs
    make_conflict(first, second, workspace)

    first.click("#banner >> text=Load their version")

    expect(first.locator("#banner")).to_be_hidden()
    assert editor_text(first) == "- milk\n- eggs\n"
    expect(tab(first, "todo.md")).not_to_contain_class("dirty")


def test_file_changed_elsewhere_reloads_quietly_without_local_edits(page, workspace):
    (workspace / "a.txt").write_text("old\n")
    open_app(page)
    open_file(page, "a.txt")

    (workspace / "a.txt").write_text("changed by another program\n")
    tab(page, "scratch.txt").click()
    tab(page, "a.txt").click()

    expect(page.locator("#status")).to_contain_text("Reloaded a.txt")
    assert editor_text(page) == "changed by another program\n"


def test_crash_recovery_offers_unsaved_text(page, workspace):
    (workspace / "a.txt").write_text("saved\n")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "a.txt")
    type_at_end(page, "precious words")
    page.wait_for_timeout(DRAFT_DELAY)

    page.once("dialog", lambda dialog: dialog.accept())  # "Leave site?"
    page.reload()

    expect(page.locator("#banner")).to_contain_text("Recovered unsaved changes")
    assert editor_text(page) == "saved\nprecious words"
    page.click("#banner >> text=Keep them")
    wait_for_file(workspace / "a.txt", "saved\nprecious words")


def test_crash_recovery_discard(page, workspace):
    (workspace / "a.txt").write_text("saved\n")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "a.txt")
    type_at_end(page, "throwaway")
    page.wait_for_timeout(DRAFT_DELAY)
    page.once("dialog", lambda dialog: dialog.accept())
    page.reload()

    page.click("#banner >> text=Discard")

    assert editor_text(page) == "saved\n"
    expect(tab(page, "a.txt")).not_to_contain_class("dirty")


def test_recovered_draft_does_not_overwrite_a_newer_file(page, workspace):
    (workspace / "a.txt").write_text("v1\n")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "a.txt")
    type_at_end(page, "draft")
    page.wait_for_timeout(DRAFT_DELAY)

    (workspace / "a.txt").write_text("changed while the browser was closed\n")
    page.once("dialog", lambda dialog: dialog.accept())
    page.reload()

    expect(page.locator("#banner")).to_contain_text("was changed somewhere else")
    assert (workspace / "a.txt").read_text() == "changed while the browser was closed\n"


@pytest.mark.parametrize("choice, on_disk, tab_left_open", [
    ("Cancel", "a\n", True),
    ("Don't save", "a\n", False),
    ("Save", "a\nedit", False),
])
def test_closing_with_autosave_off_asks_first(page, workspace, choice, on_disk, tab_left_open):
    (workspace / "a.txt").write_text("a\n")
    open_app(page)
    set_autosave(page, False)
    open_file(page, "a.txt")
    type_at_end(page, "edit")

    page.click(".tab.active .tab-close")
    expect(page.locator("#unsaved-dialog")).to_be_visible()
    expect(page.locator("#unsaved-dialog p")).to_have_text("Save changes to a.txt before closing?")
    page.click(f"#unsaved-dialog button:text-is(\"{choice}\")")

    expect(tab(page, "a.txt")).to_have_count(1 if tab_left_open else 0)
    wait_for_file(workspace / "a.txt", on_disk)


def test_closing_with_autosave_on_saves_without_asking(page, workspace):
    (workspace / "a.txt").write_text("a\n")
    open_app(page)
    open_file(page, "a.txt")
    type_at_end(page, "edit")

    page.click(".tab.active .tab-close")

    expect(tab(page, "a.txt")).to_have_count(0)
    expect(page.locator("#unsaved-dialog")).to_be_hidden()
    wait_for_file(workspace / "a.txt", "a\nedit")


def test_leaving_the_page_warns_only_when_edits_would_be_lost(page, workspace):
    (workspace / "a.txt").write_text("a\n")
    open_app(page)
    open_file(page, "a.txt")
    dialogs = []
    page.on("dialog", lambda dialog: (dialogs.append(dialog.type), dialog.dismiss()))

    type_at_end(page, "x")  # autosave on: nothing to warn about once saved
    wait_for_file(workspace / "a.txt", "a\nx")
    page.reload()
    expect(page.locator(".tab.active")).to_have_attribute("title", "a.txt")  # restored
    assert dialogs == []

    set_autosave(page, False)
    type_at_end(page, "y")
    # Reload from the page itself: page.reload() would wait for a navigation that
    # never happens, because dismissing the warning keeps us on the page.
    page.evaluate("location.reload()")
    page.wait_for_timeout(500)
    assert dialogs == ["beforeunload"]
