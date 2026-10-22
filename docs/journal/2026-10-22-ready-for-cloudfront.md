# 2026-10-22: Getting the app ready for CloudFront (prod move, step A)

## Goal
Charlie asked for the next step after 1.0.0: moving Maplenote to
workloads-prod. Most of the design was decided on 2026-10-20 (its own
CloudFront distribution, the shared WAF, OAC in front of the function URL).
Before writing Terraform, check that design against the code.

## What was done
- **Read the design against the code** and found three gaps:
  1. OAC needs the hash of every PUT/POST body, and the sign-in page was a
     plain HTML form, which can't add headers. Signing in would have failed.
  2. The page (`/`) set the "signed in" hint cookie, but in prod the page is
     a file on S3, so it never would. `/login` and `/logout` also have to
     reach Lambda, not only `/api`.
  3. The security headers come from `app.py`; files from S3 don't pass
     through it, so CloudFront has to add them (left for the Terraform step).
- **Charlie's answers:** no notes move from sandbox; deploys to prod wait for
  approval; keep the password for the move and do Cognito after.
- **This PR fixes 1 and 2:** `static/body-hash.js` (a 10-line SHA-256
  helper), used by `api()` in `app.js` for every non-GET request and by the
  new `static/login.js`, which sends the sign-in form itself. `app.py` sets
  the hint cookie at sign-in as well as with the page. Nothing changes for
  a user, so no new version in the changelog.

## Problems and fixes
- None so far. Plain-HTTP addresses (the Chromebook's `penguin.linux.test`)
  have no `crypto.subtle`, so the hash is skipped there instead of failing.

## How it was verified
- `python -m pytest`: 147 passed (5 real-S3 tests skipped, as usual).
- New browser test: signing in, saving, creating and deleting each send
  `x-amz-content-sha256` matching the SHA-256 of the body the browser
  actually sent (computed again in Python). The existing sign-in tests now
  go through `login.js`. The API sign-in test checks the hint cookie comes
  with the sign-in.
- Proved they fail: removing the hash from `api()`, removing it from
  `login.js`, and not setting the hint at sign-in each failed a test.

## Impact
No visible change, no cost. The Terraform step (B) can now assume the app
works behind CloudFront with OAC.
