# 2026-10-19: Documentation review at the "live on AWS" milestone

## Goal
Charlie noticed the README still called Maplenote "locally hosted", although
it has run on AWS Lambda since earlier the same day. With the app live, this
was a good point to check every doc against what actually exists, in both
this repo and `cloud-homelab`.

## What was done
- **README:** rewrote the opening and the diagram so they cover both ways
  Maplenote runs (locally, and on Lambda with S3 storage behind a sign-in
  page). Added "Using the hosted copy" (where the address is, signing in and
  out, the 5 MB limit, cold starts). Fixed the Python version (3.11, what the
  tests run on, not "3.9 or newer") and the test count (104 → about 125).
- **`CLAUDE.md` and `app.py`'s docstring:** "locally hosted" → "self-hosted"
  (the docstring change is a comment only; merging it re-runs the deploy).
- **Portfolio:** the one-sentence summary and a resume bullet now say the
  app is deployed, not "designed for later AWS deployment"; added a bullet
  for the Docker/Lambda/OIDC pipeline; updated the numbers (15 PRs in 3 days,
  127 tests of which 5 run against real S3).
- **A claim that wasn't true:** the password decision and the "Putting a
  personal app online" interview story said the function was capped at 2
  copies at once. That cap was planned but never set: sandbox's Lambda limit
  is 10 and AWS keeps 10 unreserved, so nothing can be reserved (recorded in
  `cloud-homelab`). Added a correction under the decision (not a rewrite),
  fixed the story, added a known limitation, and parked "reserve 2 copies if
  the limit is raised".
- **Runbooks:** `deploy-sandbox.md` still said "once this PR is merged,
  `python auth.py` does the same"; it now just uses `python auth.py`.
  `daily-use-and-updates.md` points to the hosted copy.

## Problems and fixes
The concurrency mismatch was the only factual error found, and it mattered:
it was in an interview story, where a wrong detail is the kind an
interviewer probes. It came from the plan being written before the account
limit was checked, and only the `cloud-homelab` docs were corrected at the
time.

## How it was verified
- Counted tests with `python -m pytest --collect-only -q` (127 collected, 5 of
  them in `tests/test_real_s3.py`) and decisions with `grep '^## '
  docs/DECISIONS.md` (24).
- Checked the concurrency setting in `cloud-homelab`
  (`maplenote_reserved_concurrency = -1` in the apply notes, and
  `docs/INVENTORY.md`).
- `python -m pytest tests/test_api.py` still passes after the docstring change.

## Impact
Docs only (plus one docstring). The README now matches what a visitor would
actually find, and the portfolio and interview material contain no claim
that isn't true.
