"""The Markdown preview, including its protection against malicious files."""
from playwright.sync_api import expect

from .helpers import open_app, open_file, type_at_end

NOTE = """# Weekend plans

Some **bold** text.
A single line break
stays a line break.

- [ ] buy milk
- [x] fix the bike
- plain item

| Day | Plan |
|-----|------|
| Sat | Hike |

[a web link](https://example.com) and [another note](ideas.md)
"""

# Classic ways to sneak code into a page. None of them may run.
ATTACKS = """# Attacks
<script>window.pwned = 1</script>
<img src=x onerror="window.pwned = 2">
[click me](javascript:window.pwned=3)
"""


def test_switch_appears_only_on_markdown_files(page, workspace):
    (workspace / "notes.md").write_text(NOTE)
    (workspace / "plain.txt").write_text("text")
    open_app(page)

    expect(page.locator("#view-switch")).to_be_hidden()
    open_file(page, "notes.md")
    expect(page.locator("#view-switch")).to_be_visible()
    open_file(page, "plain.txt")
    expect(page.locator("#view-switch")).to_be_hidden()


def test_preview_renders_the_note(page, workspace):
    (workspace / "notes.md").write_text(NOTE)
    open_app(page)
    open_file(page, "notes.md")

    page.click("#preview-mode-button")

    preview = page.locator("#preview")
    expect(page.locator(".cm-editor")).to_be_hidden()
    expect(preview.locator("h1")).to_have_text("Weekend plans")
    expect(preview.locator("strong")).to_have_text("bold")
    expect(preview.locator("br")).to_have_count(2)  # three lines, two breaks
    expect(preview.locator("li.task input")).to_have_count(2)
    expect(preview.locator("li.task input").nth(1)).to_be_checked()
    expect(preview.locator("td").first).to_have_text("Sat")
    expect(page.locator("#find-button")).to_be_disabled()
    expect(page.locator("#cursor-info")).to_have_text("Preview (read-only)")


def test_malicious_markdown_stays_harmless(page, workspace):
    (workspace / "attack.md").write_text(ATTACKS)
    open_app(page)
    open_file(page, "attack.md")

    page.click("#preview-mode-button")

    preview = page.locator("#preview")
    expect(preview.locator("h1")).to_have_text("Attacks")
    expect(preview.locator("script")).to_have_count(0)
    expect(preview.locator("img")).to_have_count(0)
    expect(preview.locator('a[href^="javascript"]')).to_have_count(0)
    expect(preview).to_contain_text("<script>window.pwned = 1</script>")  # shown as text
    assert page.evaluate("window.pwned") is None


def test_links_never_navigate_away(page, workspace, context):
    (workspace / "notes.md").write_text(NOTE)
    open_app(page)
    open_file(page, "notes.md")
    page.click("#preview-mode-button")
    start = page.url

    page.click("#preview >> text=another note")
    expect(page.locator("#status")).to_contain_text("Links to other files don't work")
    with context.expect_page() as new_tab:
        page.click("#preview >> text=a web link")
    assert new_tab.value is not page
    assert page.url == start


def test_edits_show_in_the_preview_and_the_mode_is_remembered(page, workspace):
    (workspace / "notes.md").write_text("# Title\n")
    open_app(page)
    open_file(page, "notes.md")

    type_at_end(page, "\nNew paragraph")
    page.click("#preview-mode-button")
    expect(page.locator("#preview p")).to_have_text("New paragraph")

    page.reload()
    expect(page.locator("#preview")).to_be_visible()
    expect(page.locator("#preview-mode-button")).to_have_attribute("aria-pressed", "true")
