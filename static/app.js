// Maplenote frontend. It talks to the Python server through the JSON API
// described at the top of app.py, and keeps everything else in the browser.
//
// A tab can hold one of three kinds of file:
//   "workspace": a file in the server's workspace folder (read and saved via the API)
//   "device":    a file opened from this device with the "Open…" button. The browser
//                reads and saves it directly; the server never sees it.
//   "copy":      the fallback for browsers that can't save to the original file.
//                Saving downloads a copy instead.
//
// Saving: every save goes through saveTab(). Autosave calls it a moment after you
// stop typing (if switched on), and so do the Save button and closing a tab.
// Each tab remembers the "version" of the file it loaded; if the file has changed
// somewhere else since, the save is refused and a conflict banner lets you choose.
// While you type, a draft is kept in the browser so a crash can't lose your work.
//
// Editing: the editing area is CodeMirror 6 (the global `CM`, from static/vendor/).
// There is one editor on screen, and each tab has its own CodeMirror *state*: its
// text, cursor and undo history. Switching tabs swaps the state shown in the editor.
//
// Markdown (.md) tabs can switch between Edit and Preview. The preview is rendered
// by markdown-it (the global `MD`) with raw HTML switched off, so a file can't
// inject code into the page.

const newButton = document.getElementById("new-button");
const openButton = document.getElementById("open-button");
const fileInput = document.getElementById("file-input");
const saveButton = document.getElementById("save-button");
const autosaveToggle = document.getElementById("autosave-toggle");
const renameButton = document.getElementById("rename-button");
const deleteButton = document.getElementById("delete-button");
const findButton = document.getElementById("find-button");
const statusText = document.getElementById("status");
const fileTree = document.getElementById("file-tree");
const tabBar = document.getElementById("tabs");
const banner = document.getElementById("banner");
const editorContainer = document.getElementById("editor");
const cursorInfo = document.getElementById("cursor-info");
const countInfo = document.getElementById("count-info");
const wrapToggle = document.getElementById("wrap-toggle");
const viewSwitch = document.getElementById("view-switch");
const editModeButton = document.getElementById("edit-mode-button");
const previewModeButton = document.getElementById("preview-mode-button");
const previewPane = document.getElementById("preview");
const reconnectPanel = document.getElementById("reconnect");
const reconnectName = document.getElementById("reconnect-name");
const reconnectButton = document.getElementById("reconnect-button");
const unsavedDialog = document.getElementById("unsaved-dialog");
const unsavedName = document.getElementById("unsaved-name");

// Settings remembered in the browser.
const SESSION_KEY = "maplenote.session";   // which tabs were open
const AUTOSAVE_KEY = "maplenote.autosave"; // "on" or "off"
const WRAP_KEY = "maplenote.wrap";         // "on" or "off"

// How long after the last keystroke to keep a draft and autosave.
const AUTOSAVE_DELAY_MS = 1000;

// Chrome and Edge can open a device file and save back to it. Other browsers can't,
// and neither can Chrome on an address it doesn't consider secure (e.g. penguin.linux.test).
const canSaveToDevice = "showOpenFilePicker" in window;

let scratchPath = null;          // the always-open scratch pad (the server tells us its name)
let maxFileBytes = Infinity;     // size limit, also from the server
let files = [];                  // every file in the workspace
let tabs = [];                   // open files, see newTab()
let activeTab = null;            // the tab shown in the editor
let autosaveEnabled = readSetting(AUTOSAVE_KEY) !== "off";
let wrapEnabled = readSetting(WRAP_KEY) !== "off";
const collapsedFolders = new Set();

// ------------------------------------------------------------------ helpers

function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (e.g. a private window): the setting just won't be remembered.
  }
}

const clockTime = (time = Date.now()) => new Date(time).toLocaleTimeString();

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

// ------------------------------------------------------------------ server calls

// Call the server and return its JSON reply, turning server errors into exceptions.
// The error carries the HTTP status and the server's reply (e.g. a conflict's version).
async function api(method, url, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function fileUrl(path) {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

async function refreshFileList() {
  const data = await api("GET", "/api/files");
  files = data.files;
  scratchPath = data.scratch;
  maxFileBytes = data.max_file_bytes;
  renderFileTree();
}

// ------------------------------------------------------- editor (CodeMirror)

// Colours and fonts for the editor, using the same CSS variables as style.css.
const editorTheme = CM.EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)", fontSize: "14px" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "Cascadia Code", "DejaVu Sans Mono", monospace',
    lineHeight: "1.5",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 16px 0 8px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "rgb(217 130 43 / 0.28)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px" },
  ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.03)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-selectionMatch": { backgroundColor: "rgb(255 255 255 / 0.08)" },
  // The find & replace bar.
  ".cm-searchMatch": { backgroundColor: "rgb(217 130 43 / 0.22)", outline: "1px solid rgb(217 130 43 / 0.5)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgb(217 130 43 / 0.5)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "6px 36px 6px 12px", fontFamily: "system-ui, sans-serif", fontSize: "13px" },
  ".cm-panel.cm-search label": { color: "var(--muted)" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--accent)" },
  ".cm-panel.cm-search [name=close]": { color: "var(--muted)", fontSize: "18px", right: "10px", top: "4px" },
  ".cm-textfield": {
    backgroundColor: "var(--bg)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 6px",
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "var(--accent)" },
  ".cm-button": {
    backgroundImage: "none", backgroundColor: "var(--bg)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 10px",
  },
  ".cm-button:hover": { borderColor: "var(--accent)" },
}, { dark: true });

// Word wrap can be switched on and off, so it lives in a "compartment" that can be
// swapped out later (CodeMirror's way of changing one part of the configuration).
const wrapCompartment = new CM.Compartment();
const wrapExtension = () => (wrapEnabled ? CM.EditorView.lineWrapping : []);

// Everything each tab's editor state is set up with.
function editorExtensions() {
  return [
    CM.lineNumbers(),
    CM.highlightActiveLineGutter(),
    CM.highlightActiveLine(),
    CM.drawSelection(),
    CM.history(), // undo/redo, kept separately for each tab
    CM.search({ top: true }), // find & replace bar (Ctrl+F)
    CM.highlightSelectionMatches(),
    CM.EditorState.tabSize.of(4),
    CM.keymap.of([...CM.defaultKeymap, ...CM.historyKeymap, ...CM.searchKeymap, CM.indentWithTab]),
    wrapCompartment.of(wrapExtension()),
    CM.EditorView.updateListener.of(onEditorUpdate),
    editorTheme,
  ];
}

const createEditorState = (text) => CM.EditorState.create({ doc: text, extensions: editorExtensions() });

// The one editor on screen. Hidden until a tab is shown in it.
const view = new CM.EditorView({ parent: editorContainer, state: createEditorState("") });

// The text in a tab, as a plain string.
const textOf = (tab) => tab.state.doc.toString();

// Set when Maplenote itself changes the text (e.g. reloading a file), so that
// onEditorUpdate doesn't treat it as typing.
let changingProgrammatically = false;

// Replace all of a tab's text, keeping the cursor nearby. It's an ordinary edit,
// so Ctrl+Z can undo it.
function replaceText(tab, text) {
  const head = Math.min(tab.state.selection.main.head, text.length);
  const transaction = { changes: { from: 0, to: tab.state.doc.length, insert: text }, selection: { anchor: head } };
  if (tab === activeTab && tab.loaded) {
    changingProgrammatically = true;
    try {
      view.dispatch(transaction); // onEditorUpdate stores the new state on the tab
    } finally {
      changingProgrammatically = false;
    }
  } else {
    tab.state = tab.state.update(transaction).state;
  }
  if (tab === activeTab && showsPreview(tab)) renderPreview(tab);
}

// Called by CodeMirror after every change to the editor: typing, undo, cursor moves.
function onEditorUpdate(update) {
  const tab = activeTab;
  if (!tab?.loaded || update.view !== view) return;
  tab.state = update.state;
  if (update.docChanged && !changingProgrammatically) {
    const wasDirty = !update.startState.doc.eq(tab.savedDoc);
    if (tab.recoveredAt) {
      tab.recoveredAt = null; // typing counts as keeping the recovered changes
      renderBanner();
    }
    if (isDirty(tab) !== wasDirty) renderTabs(); // the unsaved-changes dot
    scheduleSave(tab);
  }
  if (update.docChanged || update.selectionSet) updateStatusBar();
}

// Word wrap on/off: reconfigure every tab's state, not just the visible one.
function setWordWrap(enabled) {
  wrapEnabled = enabled;
  writeSetting(WRAP_KEY, enabled ? "on" : "off");
  const effects = wrapCompartment.reconfigure(wrapExtension());
  for (const tab of tabs) {
    if (!tab.state) continue;
    if (tab === activeTab && tab.loaded) view.dispatch({ effects });
    else tab.state = tab.state.update({ effects }).state;
  }
}

// The status bar under the editor: cursor position, then word and line counts.
// Counting words means reading the whole text, so it waits for a pause in typing.
let countTimer = null;
function updateStatusBar() {
  const tab = activeTab;
  clearTimeout(countTimer);
  if (!tab?.loaded) {
    cursorInfo.textContent = countInfo.textContent = "";
    return;
  }
  const range = tab.state.selection.main;
  const line = tab.state.doc.lineAt(range.head);
  const selected = range.empty ? "" : ` (${(range.to - range.from).toLocaleString()} selected)`;
  cursorInfo.textContent = showsPreview(tab)
    ? "Preview (read-only)"
    : `Ln ${line.number}, Col ${range.head - line.from + 1}${selected}`;
  countTimer = setTimeout(() => {
    if (tab !== activeTab) return;
    const words = textOf(tab).match(/\S+/g)?.length ?? 0;
    const lines = tab.state.doc.lines;
    countInfo.textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"} · ${lines.toLocaleString()} line${lines === 1 ? "" : "s"}`;
  }, 150);
}

// ------------------------------------------------------- Markdown preview

// html: false means any HTML written in a file is shown as text, never run.
// breaks: true makes a single line break a line break, as in Obsidian.
const markdown = new MD.MarkdownIt({ html: false, linkify: true, breaks: true });

const isMarkdown = (tab) => /\.(md|markdown)$/i.test(tab.name);
const showsPreview = (tab) => tab.loaded && tab.mode === "preview" && isMarkdown(tab);

function renderPreview(tab) {
  const text = textOf(tab);
  previewPane.innerHTML = text.trim()
    ? markdown.render(text)
    : '<p class="empty">Nothing to preview yet: switch to Edit and write some Markdown.</p>';
  showTaskCheckboxes();
}

// "- [ ] buy milk" and "- [x] done" list items become (read-only) checkboxes.
function showTaskCheckboxes() {
  for (const item of previewPane.querySelectorAll("li")) {
    // The text is either directly in the <li>, or in a <p> inside it (spaced-out lists).
    const holder = item.firstElementChild?.tagName === "P" ? item.firstElementChild : item;
    const text = holder.firstChild;
    const match = text?.nodeType === Node.TEXT_NODE && /^\[([ xX])\]\s/.exec(text.data);
    if (!match) continue;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = match[1] !== " ";
    text.data = text.data.slice(match[0].length);
    holder.insertBefore(checkbox, text);
    item.classList.add("task");
  }
}

// Show the active tab as either the editor or its preview.
function showEditorOrPreview(tab) {
  const preview = showsPreview(tab);
  editorContainer.hidden = !tab.loaded || preview;
  previewPane.hidden = !preview;
  if (preview) {
    renderPreview(tab);
    previewPane.scrollTop = tab.previewScroll;
    previewPane.focus();
  } else if (tab.loaded) {
    view.scrollDOM.scrollTop = tab.scroll;
    view.focus();
  }
}

function setMode(tab, mode) {
  if (tab.mode === mode) return;
  rememberEditorPosition();
  tab.mode = mode;
  showEditorOrPreview(tab);
  render();
  updateStatusBar();
  saveSession();
}

// Links in the preview: web and email links open in a new browser tab. Anything
// else (e.g. a link to another note) isn't supported yet, so it does nothing
// rather than navigating away from Maplenote.
previewPane.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener");
  else showStatus("Links to other files don't work in the preview yet.");
});

// ---------------------------------------------------- browser storage (IndexedDB)

// Two stores in the browser's IndexedDB (localStorage only holds small text):
//   "handles": file handles for device tabs, so they come back after a refresh
//   "drafts":  unsaved text for each tab, for crash recovery
function browserStore(storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maplenote", 2);
    request.onupgradeneeded = () => {
      for (const name of ["handles", "drafts"]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, mode);
      const result = action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(result.result);
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const loadHandle = (key) => browserStore("handles", "readonly", (store) => store.get(key));
const storeHandle = (key, handle) => browserStore("handles", "readwrite", (store) => store.put(handle, key));
const forgetHandle = (key) => browserStore("handles", "readwrite", (store) => store.delete(key)).catch(() => {});

const loadDraft = (key) => browserStore("drafts", "readonly", (store) => store.get(key)).catch(() => null);
const forgetDraft = (key) => browserStore("drafts", "readwrite", (store) => store.delete(key)).catch(() => {});

function storeDraft(tab) {
  if (tab.kind === "copy") return; // copy tabs can't be reopened, so a draft wouldn't help
  const draft = { content: textOf(tab), baseVersion: tab.version, savedAt: Date.now() };
  return browserStore("drafts", "readwrite", (store) => store.put(draft, tab.key)).catch(() => {});
}

// If a draft from last time differs from the file, put it back in the tab.
async function applyDraft(tab) {
  const draft = await loadDraft(tab.key);
  if (!draft) return;
  if (draft.content === tab.savedDoc.toString()) return forgetDraft(tab.key);
  replaceText(tab, draft.content); // an ordinary edit, so Ctrl+Z goes back to the saved file
  tab.recoveredAt = draft.savedAt;
  // If the file has changed since the draft was made, saving the draft must not
  // overwrite that change: keep the old version so the save raises a conflict.
  tab.version = draft.baseVersion;
}

// ------------------------------------------------------------ device files

// Read a File from the device as text, applying the same rules as the server.
async function readDeviceFile(file) {
  if (file.size > maxFileBytes) {
    throw new Error(`${file.name} is larger than ${Math.floor(maxFileBytes / 1048576)} MB.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error(`${file.name} doesn't look like a text file (it isn't valid UTF-8).`);
  }
}

// Make sure we're allowed to read (or read and write) a device file. Asking may show
// Chrome's permission prompt, which only works right after a click.
async function hasPermission(handle, mode, ask) {
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return ask && (await handle.requestPermission({ mode })) === "granted";
}

async function openFromDevice() {
  if (!canSaveToDevice) {
    fileInput.click(); // continues in the "change" listener below
    return;
  }
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: "Text files", accept: { "text/plain": [".txt", ".md", ".log"] } }],
    });
  } catch {
    return; // the picker was cancelled
  }
  for (const handle of handles) {
    try {
      await openDeviceHandle(handle);
    } catch (error) {
      showStatus(error.message, true);
    }
  }
}

async function openDeviceHandle(handle) {
  // Already open? Just switch to it.
  for (const tab of tabs) {
    if (tab.kind === "device" && (await tab.handle.isSameEntry(handle))) {
      return activateTab(tab);
    }
  }
  const file = await handle.getFile();
  const content = await readDeviceFile(file);
  const tab = newTab({
    kind: "device", key: `device:${crypto.randomUUID()}`, name: handle.name, content,
    version: file.lastModified, // for device files, "last modified" time is the version
  });
  tab.handle = handle;
  await storeHandle(tab.key, handle);
  tabs.push(tab);
  activateTab(tab);
  showStatus(`Opened ${tab.name} from your device`);
}

// Fallback path (no showOpenFilePicker): read the chosen files into "copy" tabs.
fileInput.addEventListener("change", async () => {
  for (const file of fileInput.files) {
    try {
      const content = await readDeviceFile(file);
      const tab = newTab({ kind: "copy", key: `copy:${crypto.randomUUID()}`, name: file.name, content });
      tabs.push(tab);
      activateTab(tab);
      showStatus(`Opened ${file.name}. This browser can't save to the original; Save downloads a copy.`);
    } catch (error) {
      showStatus(error.message, true);
    }
  }
  fileInput.value = ""; // so choosing the same file again still fires "change"
});

// A device tab restored after a refresh starts "not loaded" until permission is granted.
// When we have to ask, ask for read and write together so there's only one prompt.
async function loadDeviceTab(tab, { ask }) {
  if (!(await hasPermission(tab.handle, ask ? "readwrite" : "read", ask))) return false;
  const file = await tab.handle.getFile();
  tab.state = createEditorState(await readDeviceFile(file));
  tab.savedDoc = tab.state.doc;
  tab.version = file.lastModified;
  tab.loaded = true;
  await applyDraft(tab);
  return true;
}

reconnectButton.addEventListener("click", async () => {
  const tab = activeTab;
  try {
    if (await loadDeviceTab(tab, { ask: true })) activateTab(tab);
  } catch (error) {
    showStatus(error.message, true);
  }
});

// --------------------------------------------------------------------- tabs

// key:         unique id for the tab (the path for workspace files)
// name:        what the tab shows
// state:       the CodeMirror state: text, cursor and undo history
// savedDoc:    the text as it was last loaded or saved, to tell if there are unsaved edits
// version:     the version of the file this tab last loaded or saved
// conflict:    set when the file changed elsewhere: { theirVersion }
// recoveredAt: set when the tab holds a recovered draft (the draft's time)
function newTab({ kind, key, name, content = "", version = null, loaded = true }) {
  const state = createEditorState(content);
  return {
    kind, key, name, state, version, loaded,
    savedDoc: state.doc,
    conflict: null,
    recoveredAt: null,
    saving: false,
    saveAgain: false,
    timer: null,
    scroll: 0,
    mode: "edit", // or "preview" (Markdown tabs only)
    previewScroll: 0,
  };
}

// CodeMirror's documents can be compared directly; undoing back to the saved text
// makes a tab clean again.
const isDirty = (tab) => !tab.state.doc.eq(tab.savedDoc);
const findTab = (key) => tabs.find((tab) => tab.key === key);

// Open a workspace file in a tab (or switch to its tab if it's already open).
async function openFile(path, { activate = true } = {}) {
  let tab = findTab(path);
  if (!tab) {
    const file = await api("GET", fileUrl(path));
    tab = findTab(file.path); // the server may have tidied the path, e.g. "./a.txt" -> "a.txt"
    if (!tab) {
      tab = newTab({ kind: "workspace", key: file.path, name: file.path, content: file.content, version: file.version });
      // The scratch pad always sits first.
      if (tab.key === scratchPath) tabs.unshift(tab);
      else tabs.push(tab);
    }
  }
  if (activate) activateTab(tab);
  return tab;
}

function activateTab(tab) {
  rememberEditorPosition();
  activeTab = tab;
  reconnectPanel.hidden = tab.loaded;
  if (tab.loaded) {
    view.setState(tab.state); // its text, cursor, undo history and find bar
  } else {
    reconnectName.textContent = tab.name;
  }
  showEditorOrPreview(tab);
  document.title = `${tab.name} · Maplenote`;
  render();
  updateStatusBar();
  saveSession();
  checkForOutsideChanges(tab);
}

// The cursor is part of each tab's state; the scroll position isn't, so keep it
// separately and switching back lands where you left off.
function rememberEditorPosition() {
  if (!activeTab?.loaded) return;
  if (showsPreview(activeTab)) activeTab.previewScroll = previewPane.scrollTop;
  else activeTab.scroll = view.scrollDOM.scrollTop;
}

// Would this tab's unsaved edits be saved automatically? (Copy tabs never autosave.)
const autosaves = (tab) => autosaveEnabled && tab.kind !== "copy";

// Ask "Save changes before closing?" Resolves to "save", "discard" or "cancel".
function askToSave(tab) {
  unsavedName.textContent = tab.name;
  unsavedDialog.returnValue = "";
  unsavedDialog.showModal();
  return new Promise((resolve) => {
    // Pressing Escape closes the dialog with no value, which counts as Cancel.
    unsavedDialog.addEventListener("close", () => resolve(unsavedDialog.returnValue || "cancel"), { once: true });
  });
}

// Close a tab. Unsaved edits are saved first when the tab autosaves; otherwise you're
// asked whether to save them. Pass discard: true to close without saving or asking.
async function closeTab(tab, { discard = false } = {}) {
  if (tab.key === scratchPath) return;
  clearTimeout(tab.timer);
  if (!discard && isDirty(tab)) {
    let choice = "save";
    if (!autosaves(tab)) {
      if (tab !== activeTab) activateTab(tab); // show what you're being asked about
      choice = await askToSave(tab);
    }
    if (choice === "cancel") return;
    if (choice === "save") {
      tab.recoveredAt = null; // closing counts as keeping recovered changes
      await saveTab(tab, { manual: true }); // closing is a click, so a permission prompt may show
      if (isDirty(tab)) {
        if (tab !== activeTab) activateTab(tab);
        showStatus(`Couldn't save ${tab.name}, so it's still open.`, true);
        return;
      }
    } else {
      showStatus(`Closed ${tab.name} without saving`);
    }
  }
  forgetDraft(tab.key);
  if (tab.kind === "device") forgetHandle(tab.key);
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  if (tab === activeTab) {
    activeTab = null;
    activateTab(tabs[Math.min(index, tabs.length - 1)]);
  } else {
    render();
    saveSession();
  }
}

function saveSession() {
  const session = {
    // "copy" tabs can't be reopened without the user picking the file again.
    open: tabs.filter((tab) => tab.kind !== "copy").map((tab) => tab.key),
    active: activeTab?.key,
    preview: tabs.filter((tab) => tab.mode === "preview").map((tab) => tab.key),
  };
  writeSetting(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    return JSON.parse(readSetting(SESSION_KEY)) ?? {};
  } catch {
    return {};
  }
}

// Bring back a tab from last time, with any unsaved draft. Throws if its file is gone.
async function restoreTab(key) {
  if (!key.startsWith("device:")) {
    const tab = await openFile(key, { activate: false });
    await applyDraft(tab);
    return;
  }
  const handle = await loadHandle(key);
  if (!handle) return;
  const tab = newTab({ kind: "device", key, name: handle.name, loaded: false });
  tab.handle = handle;
  try {
    // If Chrome still remembers the permission, load it now; otherwise the tab
    // shows an "Allow access" button when you switch to it.
    await loadDeviceTab(tab, { ask: false });
  } catch (error) {
    forgetHandle(key); // the file was moved or deleted on the device
    forgetDraft(key);
    throw error;
  }
  tabs.push(tab);
}

// ----------------------------------------------------------------- saving

// Called a moment after you stop typing: keep a draft, then autosave if it's on.
function scheduleSave(tab) {
  clearTimeout(tab.timer);
  tab.timer = setTimeout(() => {
    if (!isDirty(tab)) return;
    storeDraft(tab);
    if (autosaveEnabled) saveTab(tab);
  }, AUTOSAVE_DELAY_MS);
}

// Save a tab. manual: true means the user asked (Save button, closing a tab), which
// allows Chrome's permission prompt and saving even without changes.
async function saveTab(tab, { manual = false } = {}) {
  if (!tab.loaded) return;
  if (tab.kind === "copy") {
    if (manual) {
      downloadCopy(tab.name, textOf(tab));
      tab.savedDoc = tab.state.doc;
      showStatus(`Downloaded a copy of ${tab.name} ${clockTime()}`);
      render();
    }
    return;
  }
  if (tab.conflict) {
    if (manual) showStatus(`${tab.name} was changed somewhere else. Choose what to do above the editor first.`, true);
    return;
  }
  // Recovered changes wait until you choose to keep them (or start typing).
  if (tab.recoveredAt && !manual) return;
  if (!isDirty(tab) && !manual) return;
  if (tab.saving) {
    tab.saveAgain = true; // a save is already on its way; go again when it finishes
    return;
  }

  clearTimeout(tab.timer);
  tab.recoveredAt = null;
  tab.saving = true;
  // CodeMirror documents never change in place, so this is a snapshot of what we're
  // saving, even if typing continues while the save is on its way.
  const doc = tab.state.doc;
  const content = doc.toString();
  if (tab === activeTab) showStatus("Saving…");
  try {
    tab.version = tab.kind === "workspace"
      ? await saveToWorkspace(tab, content)
      : await saveToDevice(tab, content, manual);
    tab.savedDoc = doc;
    if (!isDirty(tab)) forgetDraft(tab.key);
    if (tab === activeTab) showStatus(`Saved ✓ ${clockTime()}`);
  } catch (error) {
    if (error.conflict) {
      tab.conflict = { theirVersion: error.version };
      showStatus(`${tab.name} was changed somewhere else.`, true);
    } else if (error.needsPermission) {
      showStatus(manual
        ? `Not saved: no permission to change ${tab.name}.`
        : `Click Save once to turn on autosave for ${tab.name}.`, manual);
    } else {
      // The draft is kept, so nothing is lost; it'll be offered back next time.
      showStatus(`Save failed: ${error.message}`, true);
    }
  } finally {
    tab.saving = false;
    render();
  }
  if (tab.saveAgain) {
    tab.saveAgain = false;
    if (autosaveEnabled) saveTab(tab);
  }
}

async function saveToWorkspace(tab, content) {
  try {
    const result = await api("PUT", fileUrl(tab.key), { content, base_version: tab.version });
    return result.version;
  } catch (error) {
    if (error.data?.conflict) Object.assign(error, { conflict: true, version: error.data.version });
    throw error;
  }
}

async function saveToDevice(tab, content, manual) {
  if (!(await hasPermission(tab.handle, "readwrite", manual))) {
    throw Object.assign(new Error("No permission"), { needsPermission: true });
  }
  const before = await tab.handle.getFile();
  if (before.lastModified !== tab.version) {
    throw Object.assign(new Error("Changed elsewhere"), { conflict: true, version: before.lastModified });
  }
  const writable = await tab.handle.createWritable();
  await writable.write(content);
  await writable.close();
  return (await tab.handle.getFile()).lastModified;
}

function downloadCopy(name, content) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// --------------------------------------------- changes made somewhere else

// Read the file as it is right now (on the server or the device).
async function readCurrent(tab) {
  if (tab.kind === "workspace") {
    const file = await api("GET", fileUrl(tab.key));
    return { content: file.content, version: file.version };
  }
  const file = await tab.handle.getFile();
  return { content: await readDeviceFile(file), version: file.lastModified };
}

// When you switch to a tab or come back to the window, check whether its file changed.
// No unsaved edits here: quietly reload. Unsaved edits: show the conflict banner.
async function checkForOutsideChanges(tab) {
  if (!tab?.loaded || tab.kind === "copy" || tab.saving || tab.conflict) return;
  const expected = tab.version;
  let version;
  try {
    if (tab.kind === "workspace") {
      version = (await api("GET", `/api/stat?path=${encodeURIComponent(tab.key)}`)).version;
    } else {
      if (!(await hasPermission(tab.handle, "read", false))) return;
      version = (await tab.handle.getFile()).lastModified;
    }
  } catch {
    return; // deleted, or the server isn't reachable: nothing to compare against
  }
  // Nothing changed, or one of our own saves finished meanwhile (so the answer is stale).
  if (version === expected || tab.version !== expected || tab.saving || tab.conflict) return;
  if (isDirty(tab)) {
    tab.conflict = { theirVersion: version };
    if (tab === activeTab) showStatus(`${tab.name} was changed somewhere else.`, true);
    render();
  } else {
    await loadTheirs(tab);
    if (tab === activeTab) showStatus(`Reloaded ${tab.name}: it was changed somewhere else.`);
  }
}

// Conflict choice 1: drop this tab's edits and show the file as it is now.
async function loadTheirs(tab) {
  const current = await readCurrent(tab);
  clearTimeout(tab.timer);
  replaceText(tab, current.content);
  Object.assign(tab, { savedDoc: tab.state.doc, version: current.version, conflict: null, recoveredAt: null });
  forgetDraft(tab.key);
  render();
}

// Conflict choice 2: overwrite the file with this tab's version.
async function keepMine(tab) {
  tab.version = tab.conflict.theirVersion; // "I've seen their version, overwrite it"
  tab.conflict = null;
  await saveTab(tab, { manual: true });
}

// Conflict choice 3 (workspace files): save this tab's version as a new file, then load theirs.
async function saveMineAsCopy(tab) {
  const copyPath = await createConflictCopy(tab.key);
  await api("PUT", fileUrl(copyPath), { content: textOf(tab) });
  await loadTheirs(tab);
  await refreshFileList();
  showStatus(`Your version was saved as ${copyPath}`);
}

// "notes/todo.md" -> "notes/todo (conflict).md", or "(conflict 2)" if that's taken, and so on.
async function createConflictCopy(path) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, extension] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 1; ; n++) {
    const candidate = `${stem} (conflict${n > 1 ? ` ${n}` : ""})${extension}`;
    try {
      await api("POST", fileUrl(candidate));
      return candidate;
    } catch (error) {
      if (error.status !== 409 || n >= 50) throw error;
    }
  }
}

// Recovered draft choices.
async function keepRecovered(tab) {
  tab.recoveredAt = null;
  await saveTab(tab, { manual: true });
}

function discardRecovered(tab) {
  replaceText(tab, tab.savedDoc.toString());
  tab.recoveredAt = null;
  // The draft may have been made against an older version; check for a newer one.
  forgetDraft(tab.key);
  render();
  checkForOutsideChanges(tab);
}

// ----------------------------------------------------------------- file actions

async function newFile() {
  const path = prompt("New file name (e.g. notes.md or ideas/todo.txt):");
  if (!path) return;
  try {
    await api("POST", fileUrl(path));
  } catch (error) {
    // 409 means it already exists: just open it.
    if (error.status !== 409) return showStatus(error.message, true);
  }
  try {
    await refreshFileList();
    await openFile(path);
    showStatus(`Opened ${activeTab.name}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

// Only workspace files (other than the scratch pad) can be renamed or deleted.
const canRenameOrDelete = (tab) => tab?.kind === "workspace" && tab.key !== scratchPath;

async function renameActive() {
  const tab = activeTab;
  if (!canRenameOrDelete(tab)) return;
  const newPath = prompt("Rename to:", tab.key);
  if (!newPath || newPath === tab.key) return;
  try {
    const result = await api("POST", "/api/rename", { from: tab.key, to: newPath });
    showStatus(`Renamed ${tab.key} → ${result.path}`);
    forgetDraft(tab.key);
    tab.key = tab.name = result.path;
    if (isDirty(tab)) storeDraft(tab);
    document.title = `${tab.name} · Maplenote`;
    showEditorOrPreview(tab); // e.g. renaming notes.md to notes.txt leaves the preview
    updateStatusBar();
    saveSession();
    await refreshFileList();
    render();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function deleteActive() {
  const tab = activeTab;
  if (!canRenameOrDelete(tab)) return;
  if (!confirm(`Delete ${tab.key}? This can't be undone.`)) return;
  try {
    clearTimeout(tab.timer); // don't let a pending autosave bring the file back
    await api("DELETE", fileUrl(tab.key));
    await closeTab(tab, { discard: true });
    await refreshFileList();
    showStatus(`Deleted ${tab.key}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

// ------------------------------------------------------------------- drawing

function render() {
  renderTabs();
  renderBanner();
  renderFileTree();
  saveButton.disabled = !activeTab?.loaded;
  renameButton.disabled = !canRenameOrDelete(activeTab);
  deleteButton.disabled = !canRenameOrDelete(activeTab);
  // In Preview, the browser's own Ctrl+F searches the rendered page.
  findButton.disabled = !activeTab?.loaded || showsPreview(activeTab);
  const markdownTab = activeTab?.loaded && isMarkdown(activeTab);
  viewSwitch.hidden = !markdownTab;
  if (markdownTab) {
    editModeButton.setAttribute("aria-pressed", String(activeTab.mode !== "preview"));
    previewModeButton.setAttribute("aria-pressed", String(activeTab.mode === "preview"));
  }
}

function renderTabs() {
  tabBar.replaceChildren();
  for (const tab of tabs) {
    const element = document.createElement("div");
    element.className = "tab";
    element.classList.toggle("active", tab === activeTab);
    element.classList.toggle("dirty", isDirty(tab));
    element.classList.toggle("pinned", tab.key === scratchPath);
    element.classList.toggle("device", tab.kind !== "workspace");
    element.classList.toggle("conflict", Boolean(tab.conflict));
    element.setAttribute("role", "tab");
    element.title = {
      workspace: tab.name,
      device: `${tab.name} (on your device)`,
      copy: `${tab.name} (a copy: Save downloads it)`,
    }[tab.kind];

    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tab.name.split("/").pop();

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", `Close ${tab.name}`);
    close.addEventListener("click", (event) => {
      event.stopPropagation(); // don't also activate the tab we're closing
      closeTab(tab);
    });

    element.append(name, close);
    element.addEventListener("click", () => activateTab(tab));
    // Middle-click closes a tab, as in most editors and browsers.
    element.addEventListener("auxclick", (event) => {
      if (event.button === 1) closeTab(tab);
    });
    tabBar.append(element);
  }
}

// The bar above the editor: a conflict to resolve, or recovered changes to keep.
function renderBanner() {
  const tab = activeTab;
  let message = null;
  let style = "info";
  let actions = [];
  if (tab?.conflict) {
    message = `⚠ ${tab.name} was changed somewhere else since you opened it.`;
    style = "warning";
    actions = [["Load their version", loadTheirs], ["Keep mine", keepMine]];
    if (tab.kind === "workspace") actions.push(["Save mine as a copy", saveMineAsCopy]);
  } else if (tab?.recoveredAt) {
    message = `Recovered unsaved changes from ${clockTime(tab.recoveredAt)}.`;
    actions = [["Keep them", keepRecovered], ["Discard", discardRecovered]];
  }

  banner.hidden = !message;
  banner.className = `banner ${style}`;
  if (!message) return banner.replaceChildren();
  const text = document.createElement("p");
  text.textContent = message;
  banner.replaceChildren(text);
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      try {
        await action(tab);
      } catch (error) {
        showStatus(error.message, true);
      }
    });
    banner.append(button);
  }
}

// Turn ["a.txt", "notes/b.md", "notes/old/c.md"] into nested folders.
function buildTree(paths) {
  const root = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(path);
  }
  return root;
}

function renderFileTree() {
  fileTree.replaceChildren(renderFolder(buildTree(files), ""));
}

function renderFolder(node, folderPath) {
  const container = document.createDocumentFragment();

  const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of folderNames) {
    const path = folderPath + name + "/";
    const details = document.createElement("details");
    details.open = !collapsedFolders.has(path);
    details.addEventListener("toggle", () => {
      if (details.open) collapsedFolders.delete(path);
      else collapsedFolders.add(path);
    });

    const summary = document.createElement("summary");
    summary.textContent = name;
    const contents = document.createElement("div");
    contents.className = "folder-contents";
    contents.append(renderFolder(node.folders.get(name), path));

    details.append(summary, contents);
    container.append(details);
  }

  for (const path of node.files) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "file-item";
    item.classList.toggle("active", activeTab?.kind === "workspace" && path === activeTab.key);
    item.textContent = path.split("/").pop();
    item.title = path;
    item.addEventListener("click", () => {
      openFile(path).catch((error) => showStatus(error.message, true));
    });
    container.append(item);
  }
  return container;
}

// ------------------------------------------------------------------- wiring

newButton.addEventListener("click", newFile);
openButton.addEventListener("click", openFromDevice);
saveButton.addEventListener("click", () => activeTab && saveTab(activeTab, { manual: true }));
renameButton.addEventListener("click", renameActive);
deleteButton.addEventListener("click", deleteActive);

autosaveToggle.checked = autosaveEnabled;
autosaveToggle.addEventListener("change", () => {
  autosaveEnabled = autosaveToggle.checked;
  writeSetting(AUTOSAVE_KEY, autosaveEnabled ? "on" : "off");
  showStatus(autosaveEnabled ? "Autosave on" : "Autosave off: use Save to save your changes");
  if (autosaveEnabled) tabs.filter(isDirty).forEach((tab) => saveTab(tab));
});

findButton.addEventListener("click", () => CM.openSearchPanel(view));
editModeButton.addEventListener("click", () => activeTab && setMode(activeTab, "edit"));
previewModeButton.addEventListener("click", () => activeTab && setMode(activeTab, "preview"));

wrapToggle.checked = wrapEnabled;
wrapToggle.addEventListener("change", () => setWordWrap(wrapToggle.checked));

// Typing is handled by onEditorUpdate (in the editor section above).

// Coming back to the window: check whether the file changed while you were away.
window.addEventListener("focus", () => checkForOutsideChanges(activeTab));

// Leaving the page (closing the browser tab, refreshing) with edits that won't be
// autosaved: ask the browser to show its standard "Leave site?" warning. Browsers
// don't let pages choose that wording.
window.addEventListener("beforeunload", (event) => {
  if (tabs.some((tab) => isDirty(tab) && (!autosaves(tab) || tab.conflict))) event.preventDefault();
});

// Leaving the page: keep drafts of anything unsaved, as a last line of defence.
window.addEventListener("pagehide", () => tabs.filter(isDirty).forEach(storeDraft));

async function start() {
  await refreshFileList();
  const session = loadSession();
  // Reopen the scratch pad first, then whatever was open last time.
  for (const key of new Set([scratchPath, ...(session.open ?? [])])) {
    try {
      await restoreTab(key);
    } catch {
      // The file was deleted or renamed outside Maplenote since last time; skip it.
    }
  }
  for (const key of session.preview ?? []) {
    const tab = findTab(key);
    if (tab) tab.mode = "preview";
  }
  activateTab(findTab(session.active) ?? tabs[0]);
  const recovered = tabs.filter((tab) => tab.recoveredAt).length;
  if (recovered) showStatus(`Recovered unsaved changes in ${recovered} tab${recovered > 1 ? "s" : ""}`);
}

start().catch((error) => showStatus(error.message, true));
