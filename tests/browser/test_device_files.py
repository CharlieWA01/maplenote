"""Files opened from the device with "Open…".

A real file picker can't be clicked in an automated test, so these tests make
real file handles in the browser's private storage (the Origin Private File
System) and hand them out in place of the picker. Everything after the picker
(reading, saving, permissions, restoring after a refresh) runs for real.
"""
import pytest
from playwright.sync_api import expect

from .helpers import editor_text, open_app, tab, type_at_end

SETUP_DEVICE = """async (files) => {
  const root = await navigator.storage.getDirectory();
  for (const [name, data] of Object.entries(files)) {
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(typeof data === "string" ? data : new Uint8Array(data));
    await writable.close();
  }
  window.pick = async (name) => {
    window.showOpenFilePicker = async () => [await root.getFileHandle(name)];
  };
  window.readDevice = async (name) => (await (await root.getFileHandle(name)).getFile()).text();
  window.writeDevice = async (name, text) => {
    await new Promise((r) => setTimeout(r, 20));  // a later "last modified" time
    const writable = await (await root.getFileHandle(name)).createWritable();
    await writable.write(text);
    await writable.close();
  };
}"""


@pytest.fixture
def open_device_file(page):
    """Opens the app with two files 'on the device' ready to pick."""
    open_app(page)
    page.evaluate(SETUP_DEVICE, {
        "notes.md": "# From my device\n",
        "binary.dat": [0xFF, 0xFE, 0x00, 0x81],
    })

    def open_it(name):
        page.evaluate("(name) => pick(name)", name)
        page.click("#open-button")

    return open_it


def device_text(page, name):
    return page.evaluate("(name) => readDevice(name)", name)


def test_open_edit_and_autosave_a_device_file(page, open_device_file):
    open_device_file("notes.md")
    expect(tab(page, "notes.md")).to_contain_class("device")
    assert editor_text(page) == "# From my device\n"
    expect(page.locator("#rename-button")).to_be_disabled()

    type_at_end(page, "edited")

    expect(page.locator("#status")).to_contain_text("Saved", timeout=5000)
    assert device_text(page, "notes.md") == "# From my device\nedited"


def test_opening_the_same_file_twice_gives_one_tab(page, open_device_file):
    open_device_file("notes.md")
    open_device_file("notes.md")
    expect(tab(page, "notes.md")).to_have_count(1)


def test_binary_files_are_refused(page, open_device_file):
    open_device_file("binary.dat")
    expect(page.locator("#status")).to_contain_text("doesn't look like a text file")


def test_device_tab_comes_back_after_a_refresh(page, open_device_file):
    open_device_file("notes.md")
    page.reload()
    expect(tab(page, "notes.md")).to_have_count(1)
    assert editor_text(page) == "# From my device\n"


def test_device_file_conflict_offers_two_choices(page, open_device_file):
    open_device_file("notes.md")
    page.evaluate("() => writeDevice('notes.md', 'edited in another app\\n')")
    type_at_end(page, " mine")

    banner = page.locator("#banner")
    expect(banner).to_contain_text("was changed somewhere else", timeout=5000)
    expect(banner.locator("button")).to_have_text(["Load their version", "Keep mine"])


def test_autosave_waits_for_one_click_when_permission_is_needed(page, open_device_file):
    open_device_file("notes.md")
    page.evaluate("""() => {
      window.granted = false;
      FileSystemFileHandle.prototype.queryPermission =
        async ({ mode }) => (mode === "read" || window.granted) ? "granted" : "prompt";
      FileSystemFileHandle.prototype.requestPermission =
        async () => { window.granted = true; return "granted"; };
    }""")

    type_at_end(page, "x")
    expect(page.locator("#status")).to_contain_text("Click Save once to turn on autosave", timeout=5000)
    page.click("#save-button")
    expect(page.locator("#status")).to_contain_text("Saved")
    assert device_text(page, "notes.md") == "# From my device\nx"


def test_browsers_without_the_file_api_get_a_download_copy(context, workspace):
    context.add_init_script("delete window.showOpenFilePicker")
    page = context.new_page()
    open_app(page)

    with page.expect_file_chooser() as chooser:
        page.click("#open-button")
    chooser.value.set_files({"name": "note.txt", "mimeType": "text/plain", "buffer": b"from disk\n"})
    expect(tab(page, "note.txt")).to_have_count(1)

    type_at_end(page, "edited")
    with page.expect_download() as download:
        page.click("#save-button")
    with open(download.value.path()) as saved:
        assert saved.read() == "from disk\nedited"
