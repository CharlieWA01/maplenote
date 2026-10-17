// Maplenote frontend. It talks to the Python server through the JSON API
// described at the top of app.py, and keeps everything else in the browser.

const newButton = document.getElementById("new-button");
const saveButton = document.getElementById("save-button");
const renameButton = document.getElementById("rename-button");
const deleteButton = document.getElementById("delete-button");
const statusText = document.getElementById("status");
const fileTree = document.getElementById("file-tree");
const tabBar = document.getElementById("tabs");
const editor = document.getElementById("editor");

// Which tabs were open, remembered in the browser so a refresh restores them.
const SESSION_KEY = "maplenote.session";

let scratchPath = null;          // the always-open scratch pad (the server tells us its name)
let files = [];                  // every file in the workspace
let tabs = [];                   // open files: { path, content, savedContent, selection, scroll }
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
  renderFileTree();
}

// --------------------------------------------------------------------- tabs

const isDirty = (tab) => tab.content !== tab.savedContent;
const findTab = (path) => tabs.find((tab) => tab.path === path);

// Open a file in a tab (or switch to its tab if it's already open).
async function openFile(path, { activate = true } = {}) {
  let tab = findTab(path);
  if (!tab) {
    const file = await api("GET", fileUrl(path));
    tab = findTab(file.path); // the server may have tidied the path, e.g. "./a.txt" -> "a.txt"
    if (!tab) {
      tab = { path: file.path, content: file.content, savedContent: file.content, selection: 0, scroll: 0 };
      // The scratch pad always sits first.
      if (tab.path === scratchPath) tabs.unshift(tab);
      else tabs.push(tab);
    }
  }
  if (activate) activateTab(tab);
  return tab;
}

function activateTab(tab) {
  rememberEditorPosition();
  activeTab = tab;
  editor.value = tab.content;
  editor.disabled = false;
  editor.setSelectionRange(tab.selection, tab.selection);
  editor.scrollTop = tab.scroll;
  editor.focus();
  document.title = `${tab.path} · Maplenote`;
  render();
  saveSession();
}

// Keep the cursor and scroll position, so switching back lands where you left off.
function rememberEditorPosition() {
  if (!activeTab) return;
  activeTab.selection = editor.selectionStart;
  activeTab.scroll = editor.scrollTop;
}

function closeTab(tab) {
  if (tab.path === scratchPath) return;
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
    open: tabs.map((tab) => tab.path),
    active: activeTab?.path,
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

// ----------------------------------------------------------------- file actions

async function saveActive() {
  const tab = activeTab;
  if (!tab) return;
  const content = tab.content;
  try {
    await api("PUT", fileUrl(tab.path), { content });
    tab.savedContent = content;
    showStatus(`Saved ✓ ${new Date().toLocaleTimeString()}`);
    render();
  } catch (error) {
    showStatus(`Save failed: ${error.message}`, true);
  }
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
    showStatus(`Opened ${activeTab.path}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function renameActive() {
  const tab = activeTab;
  if (!tab || tab.path === scratchPath) return;
  const newPath = prompt("Rename to:", tab.path);
  if (!newPath || newPath === tab.path) return;
  try {
    const result = await api("POST", "/api/rename", { from: tab.path, to: newPath });
    showStatus(`Renamed ${tab.path} → ${result.path}`);
    tab.path = result.path;
    document.title = `${tab.path} · Maplenote`;
    saveSession();
    await refreshFileList();
    render();
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function deleteActive() {
  const tab = activeTab;
  if (!tab || tab.path === scratchPath) return;
  if (!confirm(`Delete ${tab.path}? This can't be undone.`)) return;
  try {
    await api("DELETE", fileUrl(tab.path));
    closeTab(tab);
    await refreshFileList();
    showStatus(`Deleted ${tab.path}`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

// ------------------------------------------------------------------- drawing

function render() {
  renderTabs();
  renderFileTree();
  const editable = activeTab && activeTab.path !== scratchPath;
  saveButton.disabled = !activeTab;
  renameButton.disabled = !editable;
  deleteButton.disabled = !editable;
}

function renderTabs() {
  tabBar.replaceChildren();
  for (const tab of tabs) {
    const element = document.createElement("div");
    element.className = "tab";
    element.classList.toggle("active", tab === activeTab);
    element.classList.toggle("dirty", isDirty(tab));
    element.classList.toggle("pinned", tab.path === scratchPath);
    element.setAttribute("role", "tab");
    element.title = tab.path;

    const name = document.createElement("span");
    name.textContent = tab.path.split("/").pop();

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", `Close ${tab.path}`);
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
    item.classList.toggle("active", path === activeTab?.path);
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
saveButton.addEventListener("click", saveActive);
renameButton.addEventListener("click", renameActive);
deleteButton.addEventListener("click", deleteActive);

editor.addEventListener("input", () => {
  if (!activeTab) return;
  const wasDirty = isDirty(activeTab);
  activeTab.content = editor.value;
  if (isDirty(activeTab) !== wasDirty) renderTabs();
});

async function start() {
  await refreshFileList();
  const session = loadSession();
  // Reopen the scratch pad first, then whatever was open last time.
  for (const path of [scratchPath, ...(session.open ?? [])]) {
    try {
      await openFile(path, { activate: false });
    } catch {
      // The file was deleted or renamed outside Maplenote since last time; skip it.
    }
  }
  activateTab(findTab(session.active) ?? tabs[0]);
}

start().catch((error) => showStatus(error.message, true));
