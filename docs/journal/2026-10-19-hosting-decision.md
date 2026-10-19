# 2026-10-19: Deciding how Maplenote runs on AWS

## Goal
With the AWS foundation finished in `cloud-homelab`, decide how Maplenote
will be hosted there and what local work comes first.

## What was done
- Compared the two plans that had drifted apart: Maplenote's roadmap said
  Dockerfile + gunicorn (an always-on container), while `cloud-homelab`'s
  said Lambda + S3 + Cognito (serverless, matching its "serverless first"
  rule and $10/month budget).
- Charlie asked what containers would gain. Listed the real benefits: one
  image that runs anywhere (including the future Proxmox homelab), Flask
  unchanged, no Lambda payload limit or cold starts, room for live sync, and
  career value. The catch is an always-on bill of roughly $10–30/month.
- Chose the middle path: **a Docker image running on Lambda** via AWS's
  Lambda Web Adapter. Recorded in `docs/DECISIONS.md` with its trade-offs
  (5 MB cloud file limit, cold starts, no long-lived connections).
- Reworked the roadmap: local work first (test suite → storage layer →
  Dockerfile → configurable size limit), then going online alongside
  `cloud-homelab` Phase 2 and 3.

## Problems and fixes
- **Lambda's ~6 MB payload limit** vs. Maplenote's 10 MB file limit. Found
  while comparing options; resolved by making the limit configurable and
  using 5 MB in the cloud.

## How it was verified
A decision, not code. The cost figures are approximate and will be checked
against current AWS pricing when the infrastructure is designed.

## Impact
A clear path to AWS that keeps the monthly bill in cents and keeps the
Docker image portable to the homelab.

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_
