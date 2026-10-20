# 2026-10-20: Deploy failed on AWS's public registry limit (noted, not fixed)

## Goal
Find out why `deploy-sandbox` failed right after #20 merged, get the
deploy through, and record the cause for later.

## What was done
- The run failed in "Build and push the image", at the Dockerfile's first
  line: downloading `public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0`
  returned `429 Too Many Requests - toomanyrequests: Data limit exceeded`.
  No Maplenote code had run; the Lambda function wasn't touched, so the
  previous version stayed live.
- Cause: anonymous downloads from `public.ecr.aws` get 500 GB a month per IP
  address, and GitHub's runners share their addresses with every other
  GitHub user. Signed-in downloads count against the AWS account instead
  (5 TB a month free). Source: a summary of the ECR Public quotas
  (zenn.dev/bicstone, March 2024); AWS's ECR Public service quotas page is
  the primary source. #16's image build hit the same error earlier that day.
- Re-ran the failed job: green, and the new build-record check confirmed
  the live app was the #20 commit.
- Drafted the lasting fix (sign the deploy in to the public registry; two
  read-only permissions on the deploy role): `cloud-homelab#15` and the
  first version of this PR. Charlie chose to keep re-running for now, so
  both were dropped and the fix is parked in the roadmap.
- Runbook: a "When it fails" row for the 429. Roadmap: a known limitation
  and the parked fix.

## Problems and fixes
- Is it a bug? Not in Maplenote: it's a shared quota outside the project.
  It's a reliability gap in the build (it depends on an anonymous, shared
  allowance), which is why it's recorded as a known limitation.

## How it was verified
- The re-run of the deploy (attempt 2) succeeded, including "runs this
  commit".

## Impact
None on the app. An occasional failed build needs one click on Re-run.
