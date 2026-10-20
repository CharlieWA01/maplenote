# Maplenote: project summary

*The one page to read before a presentation, resume update or interview.
Details: `docs/journal/` (what happened), `docs/DECISIONS.md` (why),
`docs/interview/` (stories), `docs/HISTORY.md` (timeline).*

## In one sentence
A self-hosted, Notepad++-style text editor that runs as a small Python web
server and is used in the browser: tabs, autosave, conflict detection, a real
code editor and Markdown preview. Designed from day one to move to AWS, and
now live there: a Docker image on Lambda, notes in S3, deployed by GitHub
Actions without stored keys.

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
- **Pluggable storage:** a local folder or an Amazon S3 bucket, chosen by one
  setting; S3 saves use conditional writes so the conflict rule holds even
  with requests on different machines.
- **Live on AWS Lambda as a Docker image** (since 2026-10-19): one image (Flask, gunicorn and
  AWS's Lambda Web Adapter) that also runs on any machine with Docker.
  GitHub Actions builds it, pushes it to a private registry (ECR), deploys
  it and checks the live URL asks for a password, all without stored AWS
  keys (OIDC). A password with a server-side scrypt hash protects it until
  Cognito login; the app refuses to start on Lambda without one.
- **Guest mode for visitors:** no login; their notes live in their own
  browser (IndexedDB) behind the same interface as the server's files, with
  the server's rules repeated there (conflict detection across browser tabs,
  path checks, size limit). Guests never reach the files API, so trying the
  app costs nothing and can't touch real files.
- **Versioned releases:** semantic version and changelog shown in the app,
  with the deployed commit baked into the image; each deploy verifies the
  live URL serves the commit it just shipped.
- **Checked on real AWS:** after each merge that touches storage, GitHub
  Actions signs in to AWS without stored keys (OIDC) and runs the storage
  code against a real, private, encrypted S3 bucket, with a role that can
  only touch a scratch folder.

## Architecture
```
 Browser tab                               Python server (Flask)      Storage
┌───────────────────────────────────┐     ┌────────────────────────┐   ┌──────────────┐
│ CodeMirror editor + Markdown view │JSON │ /api/files, /api/file  │   │ storage.py:  │
│ tabs, autosave, drafts, conflicts │←───→│ versions (SHA-256)     │ ↔ │ local folder │
│ device files via File System API  │     │ 409 on stale saves     │   │ or S3 bucket │
└───────────────────────────────────┘     │ CSP + Host allowlist   │   └──────────────┘
  (device files never touch the server)   └────────────────────────┘
  Hosted: browser → Lambda function URL (HTTPS) → the same server in a
  Docker image on Lambda → S3. Locally: localhost → the server → a folder.
```

## Tech
Python 3.11, Flask · JavaScript (no framework), CodeMirror 6, markdown-it,
esbuild for vendoring · File System Access API, IndexedDB · Docker, gunicorn,
AWS Lambda (Web Adapter), ECR, S3 via boto3, Terraform (in `cloud-homelab`) · pytest, moto and Playwright (Python) for
automated API, storage and browser tests, run by GitHub Actions · git, GitHub pull requests · ChromeOS Linux
environment · built with Claude Code.

## By the numbers
- 15 reviewed pull requests in 3 days, from an empty repo to a live app on
  AWS (v1 features in the first 5)
- 135 automated tests: 130 (API, storage on local disk and a fake S3,
  real-browser scenarios) run on every pull request, 5 more against the real
  S3 bucket; each protection was proven by sabotaging it and watching the
  tests fail
- 24 recorded design decisions, with alternatives and reasons
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
  conflict detection (content hashing, HTTP 409), deployed to AWS Lambda.
- Packaged the app as one Docker image that runs locally or on AWS Lambda
  (Lambda Web Adapter, ECR, S3 storage with conditional writes), deployed on
  every merge by GitHub Actions via OIDC with no stored AWS keys, and
  checked after each deploy that the live URL still demands a password.
- Hardened a local web app against path traversal, DNS rebinding and XSS
  (path confinement, Host allowlist, Content-Security-Policy, HTML-disabled
  Markdown rendering), verified with automated injection tests.
- Ran the project through a branch-and-pull-request workflow with code review,
  a 130-test automated suite (pytest, Playwright) in GitHub Actions CI and a
  written decision log; directed an AI coding agent (Claude Code) through
  requirements, design and review.

## What's next
The portfolio site: the page served from S3 + CloudFront in the
workloads-prod account, then Cognito login to replace the stopgap
password, then polish; see
`docs/ROADMAP.md`. The AWS side (Terraform) lives in the `cloud-homelab`
repo.
