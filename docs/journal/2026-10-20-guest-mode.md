# 2026-10-20: Guest mode

## Goal
Build step 1 of the portfolio plan (DECISIONS.md, 2026-10-20): a visitor
opens Maplenote with no login, writes notes that stay in their own browser,
and never reaches the files API. Signed in, it stays Charlie's app with S3.

## What was done
- **Server (`app.py`, `auth.py`):** with a password set, the page and
  `/static/` are now open; the API and everything else still need signing
  in. Serving the page sets or clears a readable `maplenote_signed_in`
  cookie, which tells the page which mode to start in. Locally (no
  password) it's always set, so nothing changes on the Chromebook.
- **Page (`static/app.js`):** a "Where notes live" section with two
  interchangeable backends: `serverNotes` (the API, as before) and
  `browserNotes` (IndexedDB database `maplenote-guest`). Everything that
  used to call the API for workspace files now calls `notes`. Guest notes
  are a new tab kind, `guest`, with the same features as workspace files:
  sidebar and folders, new/rename/delete, autosave, drafts and crash
  recovery, the conflict banner across browser tabs, Markdown preview.
- **Rules in the browser:** `browserNotes` repeats the server's rules (path
  tidying, `../` refused, 5 MB limit, scratch pad protected, 409 on a stale
  save), so they hold below the buttons, not just in the UI. Multi-step
  changes (rename, conflict-checked save) run in one IndexedDB transaction.
- **Welcome note:** `static/welcome.md`, copied in on a guest's first visit
  and shown in Preview: what Maplenote is, that notes stay in the browser,
  things to try, and how it's built.
- **Toolbar:** in guest mode, "Guest · notes stay in this browser" and a
  "Sign in" link.
- Decisions in DECISIONS.md ("How guest mode works…"); roadmap ticked, with
  the `cloud-homelab` work (SCPs on Workloads, then the portfolio site in
  workloads-prod) named as the next step, no fixed date.

## Problems and fixes
- Existing tests expected the page itself to redirect to `/login` when
  signed out. That's no longer true (signed out means guest mode), so those
  tests now sign in at `/login` directly and expect guest mode after
  signing out.
- First idea was a third store in the existing `maplenote` database. That
  would need a database upgrade, which a Maplenote tab still open from
  before could block. A separate database avoids it.

## How it was verified
- `python -m pytest`: 130 passed, 5 skipped (the real-S3 ones). New:
  `tests/browser/test_guest.py` (7 tests; each also checks that no request
  went to `/api/`) and API tests for the open page, the locked API and the
  hint cookie.
- Proved the new tests can fail by breaking the code: guest mode using the
  API (6 failures), scratch pad deletable (1), no conflict check (1), API
  left open (7), no hint cookie (12). Each restored afterwards.
- Screenshot of a first guest visit in Chromium: the welcome note rendered,
  the guest bar and "Sign in" at top right.

## Impact
- Anyone can now try Maplenote without an account, and their notes cost
  nothing and never leave their browser.
- After merge, the sandbox URL opens in guest mode for anyone who has it;
  Charlie signs in with the "Sign in" link. The files still need the
  password (the deploy check of `/api/files` answering 401 is unchanged).
