# 2026-10-19: Checking the S3 backend against real S3

## Goal
Maplenote's S3 storage backend (#9) was tested only against moto, a fake
S3. Now that `cloud-homelab` is creating a real bucket in the sandbox
account, prove the code works on the real thing, and prove that GitHub
Actions can sign in to AWS through the deploy role, the path a future
deploy workflow will use.

## What was done
- `tests/test_real_s3.py`: four tests against the real bucket, skipped
  unless `MAPLENOTE_LIVE_S3_BUCKET` is set: the whole file API (save,
  conflict, create, rename, delete, 404), a save that loses a race (S3's own
  `If-Match` check refuses it), encryption at rest (`AES256`), and that the
  deploy role is refused outside its `ci-check/` folder (least privilege).
  Each test works in its own `ci-check/<run>-<random>/` folder and empties
  it afterwards.
- `.github/workflows/aws-sandbox-check.yml`: signs in with
  `aws-actions/configure-aws-credentials` using the `AWS_DEPLOY_ROLE_ARN`
  variable, prints the role it got, then runs those tests. It installs only
  Flask, boto3 and pytest (no browser), so it's quick.
- The bucket and the role's new permissions are in `cloud-homelab`
  (`terraform/sandbox/maplenote-files.tf`), in a PR of their own.

## Problems and fixes
- **The role trusts only `main`**, so the check can't run on a pull request
  (that's the point of the trust policy). It runs after merge instead, and
  can be started by hand from the Actions tab.
- **Making sure the new tests can fail.** They were run against moto with a
  fake bucket: the API and race tests passed (the test logic is right), and
  the encryption and access-denied tests failed, because moto doesn't apply
  bucket encryption or IAM. So those two test something only real AWS can
  show.

## How it was verified
- `python -m pytest`: 104 passed, 4 skipped (the real-S3 tests, as intended).
- Against moto: 2 passed, 2 failed as expected (see above).
- Still to do: the first real run, after the sandbox apply and the
  `MAPLENOTE_S3_BUCKET` variable. Result goes here.

## Impact
Nothing changes for the user yet. Each run costs well under a cent in S3
requests. A real-S3 problem shows up after merge, not before (see
DECISIONS.md).

## In my own words
_(Charlie: what you learned, what surprised you, what you'd do differently.)_
