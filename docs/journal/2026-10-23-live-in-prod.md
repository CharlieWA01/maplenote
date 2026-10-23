# 2026-10-23: Live in prod

## Goal
Bring Maplenote up in workloads-prod behind its own CloudFront
distribution, following cloud-homelab's `docs/runbooks/maplenote-prod.md`
and this repo's `docs/runbooks/go-public.md`.

## What was done
1. Made the repo public (go-public.md): role ARNs as secrets, old runs
   that showed the account ID deleted (13 of them), then the visibility
   flipped, fork-PR approval turned on and the `production` environment
   given Charlie as required reviewer, limited to `main`.
2. Charlie added a prod password hash (a different password from
   sandbox's) to cloud-homelab's prod tfvars and ran a targeted apply: the
   ECR repository and the deploy role only (5 resources).
3. First deploy-prod run, approved: it pushed the image and stopped with
   its "the function doesn't exist yet" notice, as designed.
4. Full apply (26 resources): the function, the file and web buckets,
   CloudFront with origin access control for both, the response-headers
   policy.
5. Second deploy-prod run, approved: pointed the function at the image,
   uploaded the page, cleared CloudFront's cache and ran its checks.
6. Charlie checked it in a browser: sign-in, saving a note, the About box,
   and guest mode in a private window.

## Problems and fixes
- **The fork-approval setting wasn't there** (go-public.md step 5 as first
  written): it only appears once a repo is public. The runbook now makes
  the repo public first.
- **"Protected branches only" for the environment would have blocked
  every deploy**, since `main` isn't a protected branch. Used "Selected
  branches and tags" with `main` instead.

## How it was verified
- deploy-prod's check step: `/api/files` through CloudFront without a
  password answered `401`; the live `static/build.json` named commit
  `5d80b17`; the function URL called directly answered `403`.
- The log shows `***` for the account ID (in the role ARN and the image
  address), the distribution ID and the function's address.
- The environment's settings read back through the API:
  `required_reviewers` and `branch_policy` rules, the one branch `main`.
- Charlie's browser check (above).
- `python -m pytest`: no app code changed.

## Cost impact
Pennies: Lambda, S3 and CloudFront on a few requests a day. The WAF is
the shared one the landing page already pays for (about $7 a month).
