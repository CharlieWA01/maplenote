"""Small helpers shared by the browser tests."""
import time

from playwright.sync_api import Page, expect

# Reads the text of the editor that's on screen (CodeMirror keeps it in its state,
# not in the page's HTML).
EDITOR_TEXT = "CM.EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString()"


def open_app(page: Page):
    page.goto("/")
    expect(page.locator(".tab")).not_to_have_count(0)  # the scratch pad tab is up


def open_file(page: Page, path: str):
    page.click(f'.file-item[title="{path}"]')
    expect(page.locator(".tab.active")).to_have_attribute("title", path)


def editor_text(page: Page) -> str:
    return page.evaluate(EDITOR_TEXT)


def type_at_end(page: Page, text: str):
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.keyboard.type(text)


def tab(page: Page, name: str):
    return page.locator(".tab", has=page.locator(".tab-name", has_text=name))


def set_autosave(page: Page, on: bool):
    toggle = page.locator("#autosave-toggle")
    if toggle.is_checked() != on:
        toggle.click()


def wait_for_file(path, expected: str, timeout: float = 5):
    """Wait until a file on disk has the expected contents (autosave is ~1 s)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and path.read_text() == expected:
            return
        time.sleep(0.1)
    actual = path.read_text() if path.exists() else "<missing>"
    raise AssertionError(f"{path.name} never became {expected!r}; it is {actual!r}")
