// Maplenote frontend. It talks to the Python server through the JSON API
// described at the top of app.py, and keeps everything else in the browser.
//
// Two modes, chosen when the page loads:
//   signed in (or running locally, where there's no sign-in): notes are files in
//              the server's workspace, read and saved through the API.
//   guest:     for visitors who aren't signed in. Notes are kept in this browser
//              only (IndexedDB) and the API is never called, so a guest can't
//              reach anyone's files. A first visit opens on a welcome note.
// Both kinds of note go through `notes` (see "Where notes live"), which offers
// the same calls and the same rules either way.
//
// A tab can hold one of four kinds of file:
//   "workspace": a file in the server's workspace folder (read and saved via the API)
//   "guest":     a guest's note, kept in this browser (guest mode only)
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
//
// About box: the version number at the bottom right opens it, showing the version,
// the build the app is running, and the changelog. All three come from static
// files, so it works the same in guest mode (no API call).
//
// Keyboard shortcuts (see "Keyboard shortcuts" below): Ctrl+S saves, Alt+W closes
// the tab (Chrome keeps Ctrl+W for itself), Ctrl+E switches Edit and Preview.

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
const guestBar = document.getElementById("guest-bar");
const aboutButton = document.getElementById("about-button");
const aboutDialog = document.getElementById("about-dialog");
const aboutVersion = document.getElementById("about-version");
const aboutBuild = document.getElementById("about-build");
const changelogPane = document.getElementById("changelog");
const downloadNotesButton = document.getElementById("download-notes-button");
const signOutButton = document.getElementById("sign-out-button");

// The server sets this cookie with the page when you're signed in (app.py's
// index()). It's only a hint: the API checks the real session itself.
const SIGNED_IN_COOKIE = "maplenote_signed_in";
const guestMode = !document.cookie.split("; ").includes(`${SIGNED_IN_COOKIE}=1`);

// Settings remembered in the browser.
const SESSION_KEY = guestMode ? "maplenote.guest-session" : "maplenote.session"; // which tabs were open
const AUTOSAVE_KEY = "maplenote.autosave"; // "on" or "off"
const WRAP_KEY = "maplenote.wrap";         // "on" or "off"

// How long after the last keystroke to keep a draft and autosave.
const AUTOSAVE_DELAY_MS = 1000;

// Chrome and Edge can open a device file and save back to it. Other browsers can't,
// and neither can Chrome on an address it doesn't consider secure (e.g. penguin.linux.test).
const canSaveToDevice = "showOpenFilePicker" in window;

let scratchPath = null;          // the always-open scratch pad (`notes` tells us its name)
let maxFileBytes = Infinity;     // size limit, also from `notes`
let files = [];                  // every note: files in the workspace, or a guest's notes
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

function forgetSetting(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: there was nothing to forget.
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
  // Signed out (only happens when hosted with a password): go and sign in again.
  // Dropping the hint cookie means coming back without signing in is guest mode.
  if (response.status === 401) {
    document.cookie = `${SIGNED_IN_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
    location.href = "/login";
  }
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
  const data = await notes.list();
  files = data.files;
  scratchPath = data.scratch;
  maxFileBytes = data.max_file_bytes;
  signOutButton.hidden = !data.can_sign_out; // only when hosted with a password
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

// --------------------------------------------------------------- about box

// The version is written down in one place: the first "## 1.2.3 · date" heading of
// static/changelog.md. The build record, static/build.json, is written into the
// Docker image when it's built (see Dockerfile): the commit it came from and when.
// Running straight from the source folder there's no build record.
const CHANGELOG_URL = "/static/changelog.md";
const BUILD_URL = "/static/build.json";
let changelogText = null;
// The changelog wraps its lines in the file, so unlike notes (above) a single
// line break is just a space.
const changelogMarkdown = new MD.MarkdownIt({ html: false });

// "no-cache" asks the server whether the file changed, so a new version shows up
// straight after a deploy instead of whenever the browser's copy expires.
async function fetchStatic(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

async function showVersion() {
  try {
    changelogText = await (await fetchStatic(CHANGELOG_URL)).text();
  } catch {
    return; // offline: the button keeps saying "Maplenote"
  }
  const version = /^## (\d+\.\d+\.\d+)/m.exec(changelogText)?.[1];
  if (version) {
    aboutButton.textContent = `v${version}`;
    aboutVersion.textContent = version;
  }
}

async function describeBuild() {
  let build = null;
  try {
    build = await (await fetchStatic(BUILD_URL)).json();
  } catch {
    // No build record: running from the source folder (or offline).
  }
  if (!build?.commit) return "Running from the source folder, not a built image.";
  return `Built from commit ${build.commit.slice(0, 7)}${build.built ? ` on ${build.built}` : ""}.`;
}

async function openAbout() {
  if (changelogText === null) await showVersion();
  // Only the entries, from the first version heading on (not the file's own intro).
  const start = changelogText?.search(/^## /m) ?? -1;
  changelogPane.innerHTML = start >= 0
    ? changelogMarkdown.render(changelogText.slice(start))
    : '<p class="empty">The changelog couldn\'t be loaded.</p>';
  aboutBuild.textContent = "";
  aboutDialog.showModal();
  changelogPane.scrollTop = 0;
  aboutBuild.textContent = await describeBuild();
}

// ---------------------------------------------------- browser storage (IndexedDB)

// Two stores in the browser's IndexedDB (localStorage only holds small text):
//   "handles": file handles for device tabs, so they come back after a refresh
//   "drafts":  unsaved text for each tab, for crash recovery
// (Guest notes have a database of their own, "maplenote-guest"; see below.)
function openDatabase(name, version, storeNames) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      for (const storeName of storeNames) {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function browserStore(storeName, mode, action) {
  const database = await openDatabase("maplenote", 2, ["handles", "drafts"]);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const result = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(result.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

const loadHandle = (key) => browserStore("handles", "readonly", (store) => store.get(key));
const storeHandle = (key, handle) => browserStore("handles", "readwrite", (store) => store.put(handle, key));
const forgetHandle = (key) => browserStore("handles", "readwrite", (store) => store.delete(key)).catch(() => {});

const loadDraft = (key) => browserStore("drafts", "readonly", (store) => store.get(key)).catch(() => null);

// Empty a store, except for a guest's drafts ("guest:…"), which aren't the signed-in
// notes and stay with this browser anyway.
const forgetAllButGuests = (storeName) => browserStore(storeName, "readwrite", (store) => {
  const request = store.getAllKeys();
  request.onsuccess = () => {
    for (const key of request.result) if (!String(key).startsWith("guest:")) store.delete(key);
  };
  return request;
});
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

// ------------------------------------------------------- where notes live

// Signed in or guest, the page reads and saves notes through one of these two,
// with the same calls and the same errors (a `status` of 404, 409…, and
// `conflict` plus the current `version` when a save would overwrite a change).

// Signed in: files in the workspace on the server, through the API.
const serverNotes = {
  list: () => api("GET", "/api/files"), // { files, scratch, max_file_bytes }
  read: (path) => api("GET", fileUrl(path)), // { path, content, version }
  version: async (path) => (await api("GET", `/api/stat?path=${encodeURIComponent(path)}`)).version,
  // Without a baseVersion the save overwrites whatever is there.
  async save(path, content, baseVersion) {
    try {
      return (await api("PUT", fileUrl(path), { content, base_version: baseVersion })).version;
    } catch (error) {
      if (error.data?.conflict) Object.assign(error, { conflict: true, version: error.data.version });
      throw error;
    }
  },
  create: (path) => api("POST", fileUrl(path)),
  remove: (path) => api("DELETE", fileUrl(path)),
  rename: async (from, to) => (await api("POST", "/api/rename", { from, to })).path, // the new path
};

// Guest mode: notes in this browser's IndexedDB, in a database of their own
// ("maplenote-guest", store "notes": path -> { content, version }). The rules
// are the server's: tidy paths, a size limit, a scratch pad that can't be
// renamed or deleted, and no overwriting a change made in another browser tab.
const GUEST_SCRATCH = "scratch.txt";
const GUEST_MAX_FILE_BYTES = 5 * 1024 * 1024; // as in the cloud; plenty for notes
const WELCOME_NOTE = "Welcome.md";

const guestError = (status, message, extra = {}) => Object.assign(new Error(message), { status }, extra);

// A version is just a new random label each time a note is saved.
const newVersion = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// "a/./b/../c.txt" becomes "a/c.txt", as on the server; "/x" and "../x" are refused.
function tidyPath(path) {
  if (!path || path.includes("\0")) throw guestError(400, "That path isn't valid.");
  if (path.startsWith("/")) throw guestError(403, "That path is outside your notes.");
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (!parts.pop()) throw guestError(403, "That path is outside your notes.");
  }
  if (!parts.length) throw guestError(403, "That path is outside your notes.");
  return parts.join("/");
}

// Look up one note and act on it in a single transaction, so that everything
// `act` does happens or none of it does, even with Maplenote open in two
// browser tabs. `act` gets the note (undefined if there's none) and the store,
// and may throw to cancel.
async function withGuestNote(path, mode, act) {
  const database = await openDatabase("maplenote-guest", 1, ["notes"]);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("notes", mode);
    const store = transaction.objectStore("notes");
    let result, failure;
    store.get(path).onsuccess = (event) => {
      try {
        result = act(event.target.result, store);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    // A failed step (e.g. add() finding the name taken) cancels the whole transaction.
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
}

// add() fails with a ConstraintError when the name is taken.
const alreadyExists = (path) => (error) => {
  throw error?.name === "ConstraintError" ? guestError(409, `'${path}' already exists.`) : error;
};

const browserNotes = {
  async list() {
    const database = await openDatabase("maplenote-guest", 1, ["notes"]);
    const paths = await new Promise((resolve, reject) => {
      const request = database.transaction("notes").objectStore("notes").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    paths.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return { files: paths, scratch: GUEST_SCRATCH, max_file_bytes: GUEST_MAX_FILE_BYTES };
  },
  async read(path) {
    path = tidyPath(path);
    const note = await withGuestNote(path, "readonly", (found) => found);
    if (!note) throw guestError(404, "File not found.");
    return { path, content: note.content, version: note.version };
  },
  version: async (path) => (await browserNotes.read(path)).version,
  async save(path, content, baseVersion) {
    path = tidyPath(path);
    if (new TextEncoder().encode(content).length > GUEST_MAX_FILE_BYTES) {
      throw guestError(413, `File is larger than ${GUEST_MAX_FILE_BYTES / 1048576} MB.`);
    }
    return withGuestNote(path, "readwrite", (note, store) => {
      // A note that no longer exists is simply created again, as on the server.
      if (note && baseVersion != null && note.version !== baseVersion) {
        throw guestError(409, `'${path}' was changed somewhere else.`, { conflict: true, version: note.version });
      }
      const version = newVersion();
      store.put({ content, version }, path);
      return version;
    });
  },
  async create(path) {
    path = tidyPath(path);
    await withGuestNote(path, "readwrite", (_note, store) => {
      store.add({ content: "", version: newVersion() }, path);
    }).catch(alreadyExists(path));
    return { path, created: true };
  },
  async remove(path) {
    path = tidyPath(path);
    if (path === GUEST_SCRATCH) throw guestError(403, "The scratch pad can't be deleted.");
    await withGuestNote(path, "readwrite", (note, store) => {
      if (!note) throw guestError(404, "File not found.");
      store.delete(path);
    });
  },
  async rename(from, to) {
    [from, to] = [tidyPath(from), tidyPath(to)];
    if (from === GUEST_SCRATCH) throw guestError(403, "The scratch pad can't be renamed.");
    await withGuestNote(from, "readwrite", (note, store) => {
      if (!note) throw guestError(404, "File not found.");
      store.add(note, to); // if `to` is taken, this fails and the delete is cancelled too
      store.delete(from);
    }).catch(alreadyExists(to));
    return to;
  },
};

const notes = guestMode ? browserNotes : serverNotes;

// Note tabs (workspace or guest) remember their note's path; their key is the
// path, with "guest:" in front for a guest's notes so the two never mix (drafts
// are kept by key).
const noteKind = guestMode ? "guest" : "workspace";
const noteKey = (path) => (guestMode ? `guest:${path}` : path);
const pathOfKey = (key) => (guestMode ? key.replace(/^guest:/, "") : key);
const isNote = (tab) => tab?.kind === "workspace" || tab?.kind === "guest";
const isScratch = (tab) => isNote(tab) && tab.path === scratchPath;

// A guest's first visit: make the scratch pad and the welcome note. True if
// this was the first visit.
async function setUpGuestNotes() {
  if ((await browserNotes.list()).files.includes(GUEST_SCRATCH)) return false;
  await browserNotes.save(GUEST_SCRATCH, "");
  try {
    const response = await fetch("/static/welcome.md");
    if (response.ok) await browserNotes.save(WELCOME_NOTE, await response.text());
  } catch {
    // Offline: start without the welcome note.
  }
  return true;
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

// key:         unique id for the tab (see noteKey() for workspace and guest notes)
// path:        a note's path (workspace and guest tabs only)
// name:        what the tab shows
// state:       the CodeMirror state: text, cursor and undo history
// savedDoc:    the text as it was last loaded or saved, to tell if there are unsaved edits
// version:     the version of the file this tab last loaded or saved
// conflict:    set when the file changed elsewhere: { theirVersion }
// recoveredAt: set when the tab holds a recovered draft (the draft's time)
function newTab({ kind, key, path = null, name, content = "", version = null, loaded = true }) {
  const state = createEditorState(content);
  return {
    kind, key, path, name, state, version, loaded,
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

// Open a note (a workspace file, or a guest's note) in a tab, or switch to its tab
// if it's already open.
async function openFile(path, { activate = true } = {}) {
  let tab = findTab(noteKey(path));
  if (!tab) {
    const file = await notes.read(path);
    tab = findTab(noteKey(file.path)); // the path may have been tidied, e.g. "./a.txt" -> "a.txt"
    if (!tab) {
      tab = newTab({
        kind: noteKind, key: noteKey(file.path), path: file.path, name: file.path,
        content: file.content, version: file.version,
      });
      // The scratch pad always sits first.
      if (isScratch(tab)) tabs.unshift(tab);
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
  if (isScratch(tab)) return;
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
    const tab = await openFile(pathOfKey(key), { activate: false });
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
    tab.version = isNote(tab)
      ? await notes.save(tab.path, content, tab.version)
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
  downloadFile(name, new Blob([content], { type: "text/plain" }));
}

function downloadFile(name, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// --------------------------------------------- changes made somewhere else

// Read the file as it is right now (on the server, in the browser's notes, or on the device).
async function readCurrent(tab) {
  if (isNote(tab)) {
    const file = await notes.read(tab.path);
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
    if (isNote(tab)) {
      version = await notes.version(tab.path);
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

// Conflict choice 3 (notes): save this tab's version as a new file, then load theirs.
async function saveMineAsCopy(tab) {
  const copyPath = await createConflictCopy(tab.path);
  await notes.save(copyPath, textOf(tab));
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
      await notes.create(candidate);
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
    await notes.create(path);
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

// Only notes (other than the scratch pad) can be renamed or deleted.
const canRenameOrDelete = (tab) => isNote(tab) && !isScratch(tab);

async function renameActive() {
  const tab = activeTab;
  if (!canRenameOrDelete(tab)) return;
  const newPath = prompt("Rename to:", tab.path);
  if (!newPath || newPath === tab.path) return;
  try {
    const renamedTo = await notes.rename(tab.path, newPath);
    showStatus(`Renamed ${tab.path} → ${renamedTo}`);
    forgetDraft(tab.key);
    tab.path = tab.name = renamedTo;
    tab.key = noteKey(renamedTo);
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
  if (!confirm(`Delete ${tab.path}? This can't be undone.`)) return;
  try {
    clearTimeout(tab.timer); // don't let a pending autosave bring the file back
    await notes.remove(tab.path);
    await closeTab(tab, { discard: true });
    await refreshFileList();
    showStatus(`Deleted ${tab.path}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

// ----------------------------------------------------------------- signing out

// Set while signing out, so leaving the page doesn't write drafts back.
let signingOut = false;

// Hosted only. Save what can be saved, then remove what this browser keeps about
// your notes (unsaved drafts, which tabs were open, device files' handles), because
// the next person at a shared computer would otherwise find them. Then /logout
// ends the session on the server.
async function signOut() {
  const unsaved = (tab) => isDirty(tab) && tab.kind !== "copy";
  for (const tab of tabs.filter(unsaved)) await saveTab(tab, { manual: true });
  const left = tabs.filter((tab) => isDirty(tab));
  if (left.length && !confirm(
    `These have changes that aren't saved: ${left.map((tab) => tab.name).join(", ")}.\n\nSign out anyway and lose them?`,
  )) return;
  signingOut = true;
  tabs.forEach((tab) => clearTimeout(tab.timer));
  await Promise.all([forgetAllButGuests("drafts"), forgetAllButGuests("handles")]).catch(() => {});
  forgetSetting(SESSION_KEY);
  location.href = "/logout";
}

// ------------------------------------------- downloading a guest's notes (.zip)

// A guest's notes live only in this browser, so "Download all" lets them keep a
// copy: one .zip with every note, folders included. Saved first, so unsaved
// edits go in too.
async function downloadGuestNotes() {
  for (const tab of tabs.filter((tab) => tab.kind === "guest" && isDirty(tab))) {
    await saveTab(tab, { manual: true });
  }
  const encoder = new TextEncoder();
  const entries = [];
  for (const path of (await browserNotes.list()).files) {
    entries.push({ name: path, bytes: encoder.encode((await browserNotes.read(path)).content) });
  }
  const now = new Date();
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  downloadFile(`maplenote-notes-${day}.zip`, makeZip(entries, now));
  showStatus(`Downloaded ${entries.length} note${entries.length === 1 ? "" : "s"} as a .zip`);
}

// A .zip file is the files one after another, each with a short header, then a
// table of contents at the end. Notes are small, so they're stored as they are
// (zip allows "no compression"), which keeps this short and needs no library.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
function makeZip(entries, time) {
  const encoder = new TextEncoder();
  // Zip keeps times the way MS-DOS did: to 2 seconds, in local time.
  const dosTime = (time.getHours() << 11) | (time.getMinutes() << 5) | (time.getSeconds() >> 1);
  const dosDate = ((time.getFullYear() - 1980) << 9) | ((time.getMonth() + 1) << 5) | time.getDate();
  const UTF8_NAMES = 0x0800; // the "file names are UTF-8" flag
  const parts = [];
  const contents = [];
  let offset = 0;
  // Each header is a list of [size in bytes, value], written little-endian.
  const header = (fields) => {
    const bytes = new Uint8Array(fields.reduce((total, [size]) => total + size, 0));
    const data = new DataView(bytes.buffer);
    let at = 0;
    for (const [size, value] of fields) {
      if (size === 4) data.setUint32(at, value, true);
      else data.setUint16(at, value, true);
      at += size;
    }
    return bytes;
  };
  for (const { name, bytes } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const common = [
      [2, 20], [2, UTF8_NAMES], [2, 0 /* stored */], [2, dosTime], [2, dosDate],
      [4, crc], [4, bytes.length], [4, bytes.length], [2, nameBytes.length], [2, 0],
    ];
    const local = header([[4, 0x04034b50], ...common]);
    parts.push(local, nameBytes, bytes);
    contents.push(header([[4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]), nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const contentsSize = contents.reduce((total, part) => total + part.length, 0);
  const end = header([
    [4, 0x06054b50], [2, 0], [2, 0], [2, entries.length], [2, entries.length],
    [4, contentsSize], [4, offset], [2, 0],
  ]);
  return new Blob([...parts, ...contents, end], { type: "application/zip" });
}

// The checksum zip stores for each file (CRC-32), so unzipping can spot damage.
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------ keyboard shortcuts

// Ctrl+S saves (instead of the browser's "Save page as"). Alt+W closes the tab:
// Chrome never lets a page have Ctrl+W, Ctrl+T or Ctrl+Tab. Ctrl+E switches a
// Markdown tab between Edit and Preview, as in Obsidian. Listening while the
// event is on its way down ("capture") means the editor can't swallow them.
document.addEventListener("keydown", (event) => {
  const ctrl = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const dialogOpen = Boolean(document.querySelector("dialog[open]"));
  if (ctrl && event.code === "KeyS") {
    event.preventDefault(); // even under a dialog, never the browser's "Save page as"
    if (!dialogOpen && activeTab) saveTab(activeTab, { manual: true });
  } else if (alt && event.code === "KeyW" && !dialogOpen) {
    event.preventDefault();
    if (activeTab && isScratch(activeTab)) showStatus("The scratch pad stays open.");
    else if (activeTab) closeTab(activeTab);
  } else if (ctrl && event.code === "KeyE" && !dialogOpen && activeTab?.loaded && isMarkdown(activeTab)) {
    event.preventDefault();
    setMode(activeTab, activeTab.mode === "preview" ? "edit" : "preview");
  }
}, { capture: true });

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
    element.classList.toggle("pinned", isScratch(tab));
    element.classList.toggle("device", tab.kind === "device" || tab.kind === "copy");
    element.classList.toggle("conflict", Boolean(tab.conflict));
    element.setAttribute("role", "tab");
    element.title = {
      workspace: tab.name,
      guest: `${tab.name} (saved in this browser)`,
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
    close.title = "Close (Alt+W)";
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
    if (isNote(tab)) actions.push(["Save mine as a copy", saveMineAsCopy]);
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
    item.classList.toggle("active", isNote(activeTab) && path === activeTab.path);
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
aboutButton.addEventListener("click", openAbout);
signOutButton.addEventListener("click", () => signOut().catch((error) => showStatus(error.message, true)));
downloadNotesButton.addEventListener("click", () => {
  downloadGuestNotes().catch((error) => showStatus(`Download failed: ${error.message}`, true));
});

// Typing is handled by onEditorUpdate (in the editor section above).

// Coming back to the window: check whether the file changed while you were away.
window.addEventListener("focus", () => checkForOutsideChanges(activeTab));

// Leaving the page (closing the browser tab, refreshing) with edits that won't be
// autosaved: ask the browser to show its standard "Leave site?" warning. Browsers
// don't let pages choose that wording.
window.addEventListener("beforeunload", (event) => {
  if (signingOut) return; // already asked
  if (tabs.some((tab) => isDirty(tab) && (!autosaves(tab) || tab.conflict))) event.preventDefault();
});

// Leaving the page: keep drafts of anything unsaved, as a last line of defence.
// (Not when signing out: that's just removed them on purpose.)
window.addEventListener("pagehide", () => {
  if (!signingOut) tabs.filter(isDirty).forEach(storeDraft);
});

async function start() {
  showVersion(); // in the background; the editor doesn't wait for it
  let session = loadSession();
  if (guestMode) {
    guestBar.hidden = false;
    // A first visit opens on the welcome note, shown rendered.
    const welcome = noteKey(WELCOME_NOTE);
    if (await setUpGuestNotes()) session = { open: [welcome], active: welcome, preview: [welcome] };
  }
  await refreshFileList();
  // Reopen the scratch pad first, then whatever was open last time.
  for (const key of new Set([noteKey(scratchPath), ...(session.open ?? [])])) {
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
