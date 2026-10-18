// Maplenote frontend. It talks to the Python server through the JSON API
// described at the top of app.py, and keeps everything else in the browser.
//
// A tab can hold one of three kinds of file:
//   "workspace": a file in the server's workspace folder (read and saved via the API)
//   "device":    a file opened from this device with the "Open…" button. The browser
//                reads and saves it directly; the server never sees it.
//   "copy":      the fallback for browsers that can't save to the original file.
//                Saving downloads a copy instead.

const newButton = document.getElementById("new-button");
const openButton = document.getElementById("open-button");
const fileInput = document.getElementById("file-input");
const saveButton = document.getElementById("save-button");
const renameButton = document.getElementById("rename-button");
const deleteButton = document.getElementById("delete-button");
const statusText = document.getElementById("status");
const fileTree = document.getElementById("file-tree");
const tabBar = document.getElementById("tabs");
const editor = document.getElementById("editor");
const reconnectPanel = document.getElementById("reconnect");
const reconnectName = document.getElementById("reconnect-name");
const reconnectButton = document.getElementById("reconnect-button");

// Which tabs were open, remembered in the browser so a refresh restores them.
const SESSION_KEY = "maplenote.session";

// Chrome and Edge can open a device file and save back to it. Other browsers can't,
// and neither can Chrome on an address it doesn't consider secure (e.g. penguin.linux.test).
const canSaveToDevice = "showOpenFilePicker" in window;

let scratchPath = null;          // the always-open scratch pad (the server tells us its name)
let maxFileBytes = Infinity;     // size limit, also from the server
let files = [];                  // every file in the workspace
let tabs = [];                   // open files, see newTab()
let activeTab = null;            // the tab shown in the editor
const collapsedFolders = new Set();

// ------------------------------------------------------------------ server calls

// Call the server and return its JSON reply, turning server errors into exceptions.
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
    throw error;
  }
  return data;
}

function fileUrl(path) {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

async function refreshFileList() {
  const data = await api("GET", "/api/files");
  files = data.files;
  scratchPath = data.scratch;
  maxFileBytes = data.max_file_bytes;
  renderFileTree();
}

// ------------------------------------------------------------ device files

// File handles for device tabs are kept in the browser's IndexedDB (localStorage
// can only hold text), so those tabs can come back after a refresh.
function handleStore(mode, action) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maplenote", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("handles", mode);
      const result = action(transaction.objectStore("handles"));
      transaction.oncomplete = () => resolve(result.result);
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

const loadHandle = (key) => handleStore("readonly", (store) => store.get(key));
const storeHandle = (key, handle) => handleStore("readwrite", (store) => store.put(handle, key));
const forgetHandle = (key) => handleStore("readwrite", (store) => store.delete(key));

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
  const content = await readDeviceFile(await handle.getFile());
  const tab = newTab({ kind: "device", key: `device:${crypto.randomUUID()}`, name: handle.name, content });
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
  tab.content = tab.savedContent = await readDeviceFile(await tab.handle.getFile());
  tab.loaded = true;
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

// key:  unique id for the tab (the path for workspace files)
// name: what the tab shows
function newTab({ kind, key, name, content = "", loaded = true }) {
  return { kind, key, name, content, savedContent: content, loaded, selection: 0, scroll: 0 };
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
      tab = newTab({ kind: "workspace", key: file.path, name: file.path, content: file.content });
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
}

// Keep the cursor and scroll position, so switching back lands where you left off.
function rememberEditorPosition() {
  if (!activeTab?.loaded) return;
  activeTab.selection = editor.selectionStart;
  activeTab.scroll = editor.scrollTop;
}

function closeTab(tab) {
  if (tab.key === scratchPath) return;
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  if (tab.kind === "device") forgetHandle(tab.key).catch(() => {});
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
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? {};
  } catch {
    return {};
  }
}

// Bring back a tab from last time. Returns nothing if its file is gone.
async function restoreTab(key) {
  if (!key.startsWith("device:")) return openFile(key, { activate: false });
  const handle = await loadHandle(key);
  if (!handle) return;
  const tab = newTab({ kind: "device", key, name: handle.name, loaded: false });
  tab.handle = handle;
  try {
    // If Chrome still remembers the permission, load it now; otherwise the tab
    // shows an "Allow access" button when you switch to it.
    await loadDeviceTab(tab, { ask: false });
  } catch (error) {
    forgetHandle(key).catch(() => {}); // the file was moved or deleted on the device
    throw error;
  }
  tabs.push(tab);
}

// ----------------------------------------------------------------- file actions

async function saveActive() {
  const tab = activeTab;
  if (!tab?.loaded) return;
  const content = tab.content;
  try {
    if (tab.kind === "workspace") {
      await api("PUT", fileUrl(tab.key), { content });
    } else if (tab.kind === "device") {
      if (!(await hasPermission(tab.handle, "readwrite", true))) {
        return showStatus(`Not saved: no permission to change ${tab.name}.`, true);
      }
      const writable = await tab.handle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      downloadCopy(tab.name, content);
    }
    tab.savedContent = content;
    const what = tab.kind === "copy" ? `Downloaded a copy of ${tab.name}` : "Saved ✓";
    showStatus(`${what} ${new Date().toLocaleTimeString()}`);
    render();
  } catch (error) {
    showStatus(`Save failed: ${error.message}`, true);
  }
}

function downloadCopy(name, content) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

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
    tab.key = tab.name = result.path;
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
    await api("DELETE", fileUrl(tab.key));
    closeTab(tab);
    await refreshFileList();
    showStatus(`Deleted ${tab.key}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

// ------------------------------------------------------------------- drawing

function render() {
  renderTabs();
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
saveButton.addEventListener("click", saveActive);
renameButton.addEventListener("click", renameActive);
deleteButton.addEventListener("click", deleteActive);

editor.addEventListener("input", () => {
  if (!activeTab?.loaded) return;
  const wasDirty = isDirty(activeTab);
  activeTab.content = editor.value;
  if (isDirty(activeTab) !== wasDirty) renderTabs();
});

async function start() {
  await refreshFileList();
  const session = loadSession();
  // Reopen the scratch pad first, then whatever was open last time.
  for (const key of [scratchPath, ...(session.open ?? [])]) {
    try {
      await restoreTab(key);
    } catch {
      // The file was deleted or renamed outside Maplenote since last time; skip it.
    }
  }
  activateTab(findTab(session.active) ?? tabs[0]);
}

start().catch((error) => showStatus(error.message, true));
