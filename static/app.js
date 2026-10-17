// Maplenote frontend. It talks to the Python server through the JSON API
// described at the top of app.py, and keeps everything else in the browser.

const fileSelect = document.getElementById("file-select");
const newButton = document.getElementById("new-button");
const saveButton = document.getElementById("save-button");
const statusText = document.getElementById("status");
const editor = document.getElementById("editor");

let currentPath = null; // the file being edited, relative to the workspace
let savedContent = "";  // what's on disk, so we can tell when there are unsaved edits

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
    throw new Error(data.error || `Request failed (${response.status})`);
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
  const files = await api("GET", "/api/files");
  fileSelect.replaceChildren(new Option("Open a file…", ""));
  for (const path of files) {
    fileSelect.add(new Option(path, path));
  }
  fileSelect.value = currentPath ?? "";
}

async function openFile(path) {
  try {
    const file = await api("GET", fileUrl(path));
    currentPath = file.path;
    savedContent = file.content;
    editor.value = file.content;
    editor.disabled = false;
    saveButton.disabled = false;
    fileSelect.value = currentPath;
    document.title = `${currentPath} · Maplenote`;
    showStatus(`Opened ${currentPath}`);
    editor.focus();
  } catch (error) {
    fileSelect.value = currentPath ?? "";
    showStatus(error.message, true);
  }
}

async function saveFile() {
  if (currentPath === null) return;
  const content = editor.value;
  try {
    await api("PUT", fileUrl(currentPath), { content });
    savedContent = content;
    showStatus(`Saved ✓ ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    showStatus(`Save failed: ${error.message}`, true);
  }
}

async function newFile() {
  const path = prompt("New file name (e.g. notes.md or ideas/todo.txt):");
  if (!path) return;
  try {
    // Don't overwrite a file that already exists; just open it.
    const files = await api("GET", "/api/files");
    if (files.includes(path)) return openFile(path);
    await api("PUT", fileUrl(path), { content: "" });
    await refreshFileList();
    await openFile(path);
  } catch (error) {
    showStatus(error.message, true);
  }
}

fileSelect.addEventListener("change", () => {
  if (fileSelect.value) openFile(fileSelect.value);
});
newButton.addEventListener("click", newFile);
saveButton.addEventListener("click", saveFile);
editor.addEventListener("input", () => {
  if (editor.value !== savedContent) showStatus("Unsaved changes");
});

refreshFileList().catch((error) => showStatus(error.message, true));
