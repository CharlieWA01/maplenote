# Maplenote: project summary

*The one page to read before a presentation, resume update or interview.
Details: `docs/journal/` (what happened), `docs/DECISIONS.md` (why),
`docs/interview/` (stories), `docs/HISTORY.md` (timeline).*

## In one sentence
A self-hosted, Notepad++-style text editor that runs as a small Python web
server and is used in the browser: tabs, autosave, conflict detection, a real
code editor and Markdown preview, designed from day one to move to AWS.

## The problem
I spend a lot of time in text files: notes, logs and config files, mostly on a
Chromebook. I wanted a "scratch paper" tab in my browser that could also open
and edit real files, worked on any OS, and that I understood end to end. I
also wanted a real project to learn git, GitHub and software design on.

## What I built
- **Python/Flask server** with a small JSON API over one workspace folder,
  hardened from the first commit: path confinement, Host-header allowlist
  (DNS-rebinding protection), size limits, atomic writes, Content-Security-Policy.
- **Browser front end** (plain HTML/CSS/JS, no build step): file sidebar,
  tabs, a pinned scratch pad, open/save files anywhere on the device via the
  File System Access API.
- **No lost work:** autosave (optional), crash recovery from drafts in
  IndexedDB, and **optimistic-concurrency conflict detection**: content
  hashes and HTTP 409, with *load theirs / keep mine / save as copy*.
- **CodeMirror 6 editor:** line numbers, find & replace, per-tab undo, word
  wrap, word/line counts.
- **Markdown preview** with two layers of protection against malicious files.

## Architecture
```
 Browser tab                               Python server (Flask)         Disk
┌───────────────────────────────────┐     ┌────────────────────────┐   ┌──────────────┐
│ CodeMirror editor + Markdown view │JSON │ /api/files, /api/file  │   │ workspace    │
│ tabs, autosave, drafts, conflicts │←───→│ versions (SHA-256)     │ ↔ │ folder only  │
│ device files via File System API  │     │ 409 on stale saves     │   └──────────────┘
└───────────────────────────────────┘     │ CSP + Host allowlist   │
  (device files never touch the server)   └────────────────────────┘
```

## Tech
Python 3.11, Flask · JavaScript (no framework), CodeMirror 6, markdown-it,
esbuild for vendoring · File System Access API, IndexedDB · pytest and Playwright (Python) for
automated API and browser tests, run by GitHub Actions · git, GitHub pull requests · ChromeOS Linux
environment · built with Claude Code.

## By the numbers
- 5 reviewed pull requests in 2 days, from an empty repo to all v1 features
- 62 automated tests (API + real-browser scenarios) run on every pull request;
  each protection was proven by sabotaging it and watching the tests fail
- 19 recorded design decisions, with alternatives and reasons
- 8 MB / 120,000-line log: opens in ~0.2 s, find reaches the end in ~1 s
- 0 network requests outside the machine at runtime (works offline)
- Injection test file: every payload rendered as text, nothing executed

## How it was built
With **Claude Code as a pair programmer**. I set the requirements and
direction, made the design decisions (several changed during my code
reviews), reviewed every pull request and tested each one on my Chromebook
before merging. Claude wrote most of the code, the automated tests and the
first drafts of the docs. I can explain every part of the architecture and
why it's built that way.

## Resume bullets (drafts; edit to taste)
- Built a self-hosted, browser-based text editor (Python/Flask, JavaScript,
  CodeMirror 6) with autosave, crash recovery and optimistic-concurrency
  conflict detection (content hashing, HTTP 409), designed for later AWS
  deployment.
- Hardened a local web app against path traversal, DNS rebinding and XSS
  (path confinement, Host allowlist, Content-Security-Policy, HTML-disabled
  Markdown rendering), verified with automated injection tests.
- Ran the project through a branch-and-pull-request workflow with code review,
  a 62-test automated suite (pytest, Playwright) in GitHub Actions CI and a
  written decision log; directed an AI coding agent (Claude Code) through
  requirements, design and review.

## What's next
Polish, then cloud-ready work (storage layer for S3, Dockerfile, production
web server) and deployment to AWS with a login; see `docs/ROADMAP.md`. The AWS
side is being built in the `cloud-homelab` repo.
