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

const newButton = document.getElementById("new-button");
const openButton = document.getElementById("open-button");
const fileInput = document.getElementById("file-input");
const saveButton = document.getElementById("save-button");
const autosaveToggle = document.getElementById("autosave-toggle");
const renameButton = document.getElementById("rename-button");
const deleteButton = document.getElementById("delete-button");
const statusText = document.getElementById("status");
const fileTree = document.getElementById("file-tree");
const tabBar = document.getElementById("tabs");
const banner = document.getElementById("banner");
const editor = document.getElementById("editor");
const reconnectPanel = document.getElementById("reconnect");
const reconnectName = document.getElementById("reconnect-name");
const reconnectButton = document.getElementById("reconnect-button");

// Settings remembered in the browser.
const SESSION_KEY = "maplenote.session";   // which tabs were open
const AUTOSAVE_KEY = "maplenote.autosave"; // "on" or "off"

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
  const draft = { content: tab.content, baseVersion: tab.version, savedAt: Date.now() };
  return browserStore("drafts", "readwrite", (store) => store.put(draft, tab.key)).catch(() => {});
}

// If a draft from last time differs from the file, put it back in the tab.
async function applyDraft(tab) {
  const draft = await loadDraft(tab.key);
  if (!draft) return;
  if (draft.content === tab.savedContent) return forgetDraft(tab.key);
  tab.content = draft.content;
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
  tab.content = tab.savedContent = await readDeviceFile(file);
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
// version:     the version of the file this tab last loaded or saved
// conflict:    set when the file changed elsewhere: { theirVersion }
// recoveredAt: set when the tab holds a recovered draft (the draft's time)
function newTab({ kind, key, name, content = "", version = null, loaded = true }) {
  return {
    kind, key, name, content, version, loaded,
    savedContent: content,
    conflict: null,
    recoveredAt: null,
    saving: false,
    saveAgain: false,
    timer: null,
    selection: 0,
    scroll: 0,
  };
}

const isDirty = (tab) => tab.content !== tab.savedContent;
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
  editor.hidden = !tab.loaded;
  if (tab.loaded) {
    editor.value = tab.content;
    editor.disabled = false;
    editor.setSelectionRange(tab.selection, tab.selection);
    editor.scrollTop = tab.scroll;
    editor.focus();
  } else {
    reconnectName.textContent = tab.name;
  }
  document.title = `${tab.name} · Maplenote`;
  render();
  saveSession();
  checkForOutsideChanges(tab);
}

// Keep the cursor and scroll position, so switching back lands where you left off.
function rememberEditorPosition() {
  if (!activeTab?.loaded) return;
  activeTab.selection = editor.selectionStart;
  activeTab.scroll = editor.scrollTop;
}

// Put new content into a tab (e.g. after reloading), keeping the cursor nearby.
function replaceContent(tab, content) {
  tab.content = content;
  if (tab !== activeTab) return;
  const cursor = Math.min(editor.selectionStart, content.length);
  editor.value = content;
  editor.setSelectionRange(cursor, cursor);
}

// Close a tab. With autosave on, unsaved edits are saved first; with it off they're
// discarded (you chose to save by hand). Pass discard: true to skip saving entirely.
async function closeTab(tab, { discard = false } = {}) {
  if (tab.key === scratchPath) return;
  clearTimeout(tab.timer);
  if (!discard && autosaveEnabled && tab.kind !== "copy" && isDirty(tab)) {
    tab.recoveredAt = null; // closing counts as keeping recovered changes
    await saveTab(tab, { manual: true }); // closing is a click, so a permission prompt may show
    if (isDirty(tab)) {
      if (tab !== activeTab) activateTab(tab);
      showStatus(`Couldn't save ${tab.name}, so it's still open. Turn off Autosave to close it without saving.`, true);
      return;
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
      downloadCopy(tab.name, tab.content);
      tab.savedContent = tab.content;
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
  const content = tab.content;
  if (tab === activeTab) showStatus("Saving…");
  try {
    tab.version = tab.kind === "workspace"
      ? await saveToWorkspace(tab, content)
      : await saveToDevice(tab, content, manual);
    tab.savedContent = content;
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
  replaceContent(tab, current.content);
  Object.assign(tab, { savedContent: current.content, version: current.version, conflict: null, recoveredAt: null });
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
  await api("PUT", fileUrl(copyPath), { content: tab.content });
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
  replaceContent(tab, tab.savedContent);
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

editor.addEventListener("input", () => {
  const tab = activeTab;
  if (!tab?.loaded) return;
  const wasDirty = isDirty(tab);
  tab.content = editor.value;
  if (tab.recoveredAt) {
    tab.recoveredAt = null; // typing counts as keeping the recovered changes
    renderBanner();
  }
  if (isDirty(tab) !== wasDirty) renderTabs(); // the unsaved-changes dot
  scheduleSave(tab);
});

// Coming back to the window: check whether the file changed while you were away.
window.addEventListener("focus", () => checkForOutsideChanges(activeTab));

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
  activateTab(findTab(session.active) ?? tabs[0]);
  const recovered = tabs.filter((tab) => tab.recoveredAt).length;
  if (recovered) showStatus(`Recovered unsaved changes in ${recovered} tab${recovered > 1 ? "s" : ""}`);
}

start().catch((error) => showStatus(error.message, true));
