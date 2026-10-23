# Runbook: the AWS sandbox check

The `aws-sandbox-check` workflow signs in to the AWS sandbox account the way
a deploy will (OIDC: GitHub vouches for the workflow, AWS hands back
one-hour credentials, no keys stored anywhere) and runs
`tests/test_real_s3.py` against Maplenote's real S3 bucket.

## One-time setup

1. The bucket exists: `cloud-homelab`, `docs/runbooks/terraform-workflow.md`,
   section "Maplenote's bucket".
2. A repository secret and a variable (GitHub: Settings → Secrets and
   variables → Actions): the secret `AWS_DEPLOY_ROLE_ARN` (already set; a
   secret so the public logs show *** instead of the account ID, see
   `go-public.md`) and the variable `MAPLENOTE_S3_BUCKET` (the bucket name
   from `terraform output`; masked in the logs after sign-in).

## When it runs

- Automatically when a change to `storage.py`, `tests/test_real_s3.py` or
  the workflow file is merged into `main`.
- By hand: Actions tab → **aws-sandbox-check** → **Run workflow** (branch
  `main`). Running it from any other branch fails at sign-in, on purpose:
  the AWS role only trusts `main`.

A green run means: GitHub signed in to AWS, the file API works on real S3,
real S3 refuses a save that lost a race, files are encrypted at rest, and
the role can't write or delete outside its `ci-check/` folder. The "can't
read outside" test is skipped until the bucket holds a file outside
`ci-check/` to try (S3 says "no such file" for a missing one, even to a
caller that may not read it).

## When it fails

| Message | Meaning |
|---|---|
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Not run from `main`, or the role's trust policy doesn't match this repo |
| `Set the MAPLENOTE_S3_BUCKET repository variable` | Step 2 of the setup |
| `AccessDenied` in a test other than the last | The role's S3 permissions in `cloud-homelab` don't match the bucket or folder |
| `NoSuchBucket` | The variable has a typo, or the bucket wasn't created |

The run's log lists each test as PASSED or FAILED, with the error for any
failure. Leftover files in `ci-check/` are deleted by the bucket after a day.
