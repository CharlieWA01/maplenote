# 2026-10-18: Autosave, crash recovery and conflict detection

*Backfilled on 2026-10-19 from the working session.*

## Goal
Stop losing work: save automatically, recover from crashes, and never let one
copy of a file silently overwrite another.

## What was done ([PR #3][pr3])

**Design first.** Charlie asked for autosave to be optional ("I like
options") with the Save button kept, and asked for the conflict scenario to be
explained before agreeing to it. Claude walked through a two-tab example: Tab A
and Tab B both open `todo.md`; B adds "eggs" and saves; A adds "bread" and
saves. Without detection, "eggs" silently disappears. With it, A's save is
refused and Charlie chooses: **Load their version**, **Keep mine**, or **Save
mine as a copy**.

**How it works:**
- The server gives every file a **version**: a fingerprint (SHA-256) of its
  contents. Saves send back the version they last saw; if the file has changed
  since, the server answers **409 Conflict** and the page shows the conflict
  bar. Device files compare their last-modified time in the browser.
- **Autosave** about a second after typing stops, with a toolbar toggle
  remembered per browser.
- **Crash recovery:** drafts of unsaved text are kept in the browser's
  IndexedDB and offered back next time ("Keep them / Discard"). A draft
  remembers which version it was made against, so restoring it after the file
  changed raises a conflict instead of overwriting.
- **Quiet reload:** a file changed elsewhere with no local edits just reloads.
- All saving goes through one function, `saveTab()`.

**Code review changed the design (twice).** Charlie tested the branch and
commented on the PR:
1. The Autosave checkbox "sits in the middle of otherwise similar buttons and
   feels out of place." Moved to the right end of the toolbar (`f9df0f0`).
2. With autosave off, closing a tab discarded unsaved edits without asking.
   Charlie questioned this as against normal practice. Claude explained the
   original "no alerts" choice had assumed autosave was always on, agreed it
   no longer held, and proposed: warn only when edits won't be autosaved. A
   **Save / Don't save / Cancel** dialog on closing a tab, and Chrome's "Leave
   site?" warning on closing the page. Charlie approved on the PR; built in
   `68f2d70`. The decision log records the reversal, with the old entry marked
   superseded.

## Problems and fixes
- **Autosave can't trigger Chrome's permission prompt** (prompts need a
  click), so a device file without write permission pauses autosave and says
  "Click Save once to turn on autosave for this file."
- **A race:** a "has this file changed?" check could return after one of our
  own saves had already updated the tab, making our save look like an outside
  change. Fixed by ignoring answers that arrive after the tab's version moved
  on.
- **Deleting a file with a pending autosave would have recreated it.** The
  pending save is cancelled first.

## How it was verified
Headless Chromium against a scratch workspace, including the two-tab
"milk / eggs / bread" story end to end; all three conflict choices; a file
edited by "another program"; crash recovery with Keep/Discard; a stale draft
raising a conflict; closing with autosave on and off; deleting with a pending
save; device files (autosave, conflict, quiet reload, the one-click
permission); and every dialog path (Save, Don't save, Cancel, Escape). The
earlier test suites were re-run. Charlie tested on the Chromebook, including
the two-tab conflict, and reported "tested and looking solid".

## Impact
No lost work and no silent overwrites, which matter most once the app is
used from several devices against one cloud server.

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_

[pr3]: https://github.com/CharlieWA01/maplenote/pull/3
