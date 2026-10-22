# 2026-10-22: Stopping the public-registry 429

## Goal
Image builds kept failing with "429 Too Many Requests: Data limit exceeded"
from `public.ecr.aws` (twice on 2026-10-20, three times on 2026-10-22,
including both deploys after #22 and #23). Charlie asked for an explanation,
then for the fix for deploys and for PR builds.

## What was done
- **Explained the cause:** the `Dockerfile` copies AWS's Lambda Web Adapter
  from the public registry. Anonymous downloads are limited to 500 GB a
  month per IP address, and GitHub's runners share addresses with everyone
  else's jobs, so some runners arrive with the allowance already spent.
- **Deploys** (`deploy-sandbox`, `deploy-prod`) now sign in to the public
  registry first, which needs two permissions on each deploy role
  (`cloud-homelab`, same PR as the prod Terraform). A failed sign-in only
  warns, so the order the PRs merge in doesn't matter.
- **PR builds** (`tests`, image job) keep the adapter image in GitHub's
  Actions cache and load it before building, so Docker never asks the
  registry. The first download per version retries four times.
- Docs: decision, roadmap (parked item removed, limitation rewritten),
  the deploy runbook's troubleshooting row.

## Problems and fixes
- Checked whether Docker really skips the registry when the base image is
  already loaded: in a cloud session, a two-line `Dockerfile` using the
  adapter's name failed with the very same 429 when the image wasn't
  loaded, and built cleanly once a local image with that name was loaded.

## How it was verified
- The local experiment above (with `docker build --provenance=false
  --platform linux/amd64`, as the workflows run it).
- All workflow files parse as YAML; the `tests` workflow runs the new
  cache steps on this PR itself.

## Impact
Fewer red builds and no repeated prod approvals for a problem that isn't in
the code. $0.
