# Runbook: deploying Maplenote

Maplenote runs in the workloads-prod account: the page from S3 through
CloudFront, the server as a Docker image on AWS Lambda behind
`/api/*`, `/login` and `/logout`, notes in S3. (Until 2026-10-23 there was
also a sandbox copy, shipped by a `deploy-sandbox` workflow; it was removed
once prod worked: DECISIONS.md, 2026-10-23.)

Who does what:
- **Terraform** in the `cloud-homelab` repo creates the pieces. Charlie
  runs every apply. Setup: `cloud-homelab`'s
  `docs/runbooks/maplenote-prod.md`.
- **The `deploy-prod` workflow** in this repo ships new code, after
  Charlie approves it: it builds the image, pushes it, points the function
  at it, uploads the page and checks the result.

## Everyday: deploying a change

Merging a PR that changes the app (`app.py`, `auth.py`, `config.py`,
`storage.py`, `static/`, the requirements, the `Dockerfile`) starts
`deploy-prod`, which waits: Actions tab → the run → **Review
deployments** → tick `production` → **Approve and deploy**. A green run
ends with "Maplenote is deployed to prod: <url>" in its summary. To keep
prod as it is, reject the run (or leave it; it expires after 30 days).

There's no test copy yet (a dev copy is planned; ROADMAP), so try a change
locally (`python app.py`) before approving.

Which build is live: click the version at the bottom right. The About box
says "Built from commit 1a2b3c4 on …"; that should be the merge commit on
`main`. From a terminal: `curl <url>/static/build.json`.

By hand: Actions tab → **deploy-prod** → **Run workflow** (branch
`main`), then approve. Running it again for the same commit reuses that
commit's image.

## Changing the password

1. Make a hash. In the maplenote folder, with its virtual environment
   active (`source .venv/bin/activate`): `python auth.py`. It asks for the
   password twice. Use something long (a few random words, at least 12
   characters) and keep it in a password manager. The line it prints,
   starting `scrypt:`, is the hash.
2. Replace the `maplenote_password_hash` line in `cloud-homelab`'s
   `terraform/prod/terraform.tfvars` (`vi`, single quotes aren't needed
   inside the file), then plan and apply with `cwa-prod-admin`. The plan
   shows one change to `aws_lambda_function.maplenote` (the value is
   hidden as "sensitive").

Every signed-in browser is signed out, because sessions are signed with the
password's hash.

## Rolling back

Revert the PR on GitHub (its page → **Revert**), merge the revert, and
approve the deploy-prod run it starts. That puts back both the image and
the page's files, which a function-only rollback wouldn't.

## Logs

CloudWatch log group `/aws/lambda/cwa-maplenote` in workloads-prod (kept
14 days): one line per request from gunicorn, plus any errors. Claude's
prod role can't read logs on purpose, so this needs the admin profile:

```sh
aws logs tail /aws/lambda/cwa-maplenote --since 1h --profile cwa-prod-admin
```

## When it fails

| Where | Message | Meaning |
|---|---|---|
| Waiting | never starts | Nobody approved it yet: **Review deployments** |
| Sign in to AWS | `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Not run in the `production` environment, or not from `main` |
| Build and push | `429 Too Many Requests … Data limit exceeded` from `public.ecr.aws` | AWS's public registry ran out of its anonymous allowance for that runner's IP address. Not the code. Deploys sign in to avoid it (DECISIONS.md, 2026-10-22); look for the "Couldn't sign in to public.ecr.aws" warning, then re-run |
| Point the function | notice "The function doesn't exist yet" (green) | Expected only before the first full apply |
| Check | `answered 502` or `000` | The app didn't start: check the logs (a missing password hash says "Refusing to run on AWS Lambda") |
| Check | `answered 200` through CloudFront | **The API isn't asking for a password.** Treat as urgent: check `MAPLENOTE_PASSWORD_HASH` |
| Check | fails just after `Build record: …` | The live page isn't this commit's: the upload or the cache clearing didn't take |
| Check | "Straight at the function URL … answered" anything but 403 | The function can be reached around CloudFront: check its URL's auth type (`AWS_IAM`) in the Terraform |

In the browser: a 413 "too large" on save means the file is over 5 MB,
Lambda's limit (10 MB locally).
