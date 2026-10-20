# Welcome to Maplenote

Maplenote is a small text editor that runs in the browser. I built it for myself, for notes, logs and config files, and I use it every day. You're trying it as a guest, so go ahead and write something.

**Your notes stay in this browser.** They're saved here as you type and never sent to a server. Nobody else can see them, and clearing this site's data deletes them.

## Things to try

- Switch this note between **Edit** and **Preview** (top right). Preview renders Markdown.
- Make a note with **New file**. Names like `ideas/todo.md` make folders in the sidebar.
- Write in a second browser tab, then come back to this one: Maplenote spots the change and won't overwrite it.
- **Open…** edits a text file on your own computer. It stays there: the browser saves it straight back.
- **Find** (Ctrl+F) has find and replace.

## How it's built

- **The editor:** plain HTML, CSS and JavaScript with no build step and no framework. The editing area is CodeMirror 6, and Markdown is rendered by markdown-it with raw HTML switched off, so a note can't run code in the page.
- **Not losing work:** autosave, drafts kept in the browser for crash recovery, and conflict detection. Every save carries the version it started from, and a save that would overwrite someone else's change is refused.
- **The server**, for my own notes: Python and Flask, packaged as one Docker image that runs on my Chromebook or on **AWS Lambda**, storing notes in **Amazon S3**. The AWS side is written in Terraform, and GitHub Actions deploys each change without stored AWS keys. Guest notes never touch it.
- **Tested** by pytest and Playwright (a real Chromium) on every pull request.

I designed it, reviewed every change and run it; most of the code was written with Claude Code as a pair programmer.

You can delete this note (Delete, at the top) and it won't come back.
