# 2026-10-20: Portfolio direction

## Goal
Decide what comes after Maplenote's sandbox launch, in a status and roadmap
discussion with Charlie.

## What was done
- Reviewed both repos' roadmaps, decision logs and portfolios.
- Agreed on the order: let the SCPs soak in sandbox until around Oct 26,
  then move to workloads-prod, then Cognito.
- Charlie set the bigger direction: a public portfolio site of clickable
  project tiles, useful to Charlie daily and fit to send to an employer
  who will only glance at it. Maplenote must work on click without a login.
- Worked through the design: guest notes in the visitor's browser
  (IndexedDB, not cookies), CloudFront in front so guests never reach
  Lambda, Cognito for Charlie only with sign-up off, the homelab kept off
  the public path, and Stargazer as a WebAssembly tile later.
- Checked Cognito's current pricing on the AWS pricing page: Essentials
  (the default) is free for 10,000 monthly users with no expiry; Plus has
  no free tier.
- Charlie doesn't own a domain yet; one will be registered near the end.
- Recorded the plan in both roadmaps and decision logs.

## Problems and fixes
None; planning only.

## How it was verified
Nothing built yet. The Cognito figures come from aws.amazon.com/cognito/pricing
as of 2026-10-19.

## Impact
No change to the app yet. The ground rule about logins now allows a
browser-only guest mode.
