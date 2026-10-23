# 2026-10-23: The sandbox copy removed

## Goal
With prod live and checked, stop deploying to sandbox and remove the copy
there, as planned on 2026-10-22.

## What was done
1. Deleted `.github/workflows/deploy-sandbox.yml`. Prod's deploy-prod is
   now the only deploy.
2. Rewrote `docs/runbooks/deploy-sandbox.md` as `docs/runbooks/deploy.md`
   for prod: approving a deploy, changing the password (prod's tfvars),
   rolling back (revert the PR, which puts back the page as well as the
   image), logs (admin profile: Claude's prod role can't read logs), and
   the failure table for deploy-prod's checks.
3. Pointed the README, CLAUDE.md, the Dockerfile and the daily-use runbook
   at the new runbook.
4. Kept `aws-sandbox-check`: it still tests the storage code against real
   S3 in sandbox, with the same role (cut down in `cloud-homelab`).
5. Charlie's idea for next time: a dev copy in workloads-dev, the same
   shape as prod, to try changes in before approving them (ROADMAP).

## Problems and fixes
None.

## How it was verified
- No file outside the journal, DECISIONS and the go-public runbook (both
  history) still names `deploy-sandbox`.
- The `tests` workflow on the PR.
- After `cloud-homelab`'s destroy: aws-sandbox-check run by hand, green.

## Cost impact
Saves cents a month (images and logs in sandbox).
