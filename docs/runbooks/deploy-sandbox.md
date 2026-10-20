# Runbook: deploying Maplenote to the AWS sandbox

Maplenote runs in the sandbox account as a Docker image on AWS Lambda, with
its notes in S3, at a Lambda function URL that asks for a password.

Who does what:
- **Terraform** in the `cloud-homelab` repo creates the pieces (image
  repository, function, URL, permissions). Charlie runs every apply. Steps:
  `cloud-homelab`, `docs/runbooks/terraform-workflow.md`, section
  "Maplenote on Lambda".
- **The `deploy-sandbox` workflow** in this repo ships new code: it builds
  the image, pushes it, points the function at it and checks the result.

## Everyday: deploying a change

Nothing to do: merging a PR that changes the app (`app.py`, `auth.py`,
`config.py`, `storage.py`, `static/`, the requirements, the `Dockerfile`)
starts `deploy-sandbox`. A green run ends with "Maplenote is deployed:
<url>" in its summary.

Which build is live: open the app and click the version at the bottom
right. The About box says "Built from commit 1a2b3c4 on …"; that should be
the merge commit on `main`. From a terminal: `curl <url>static/build.json`.

By hand: Actions tab → **deploy-sandbox** → **Run workflow** (branch
`main`). Running it again for the same commit reuses that commit's image.

## First time

1. **Make a password and its hash.** In the maplenote folder, with its
   virtual environment active (`source .venv/bin/activate`):

   ```sh
   python auth.py
   ```

   It asks for the password twice. Use something long (a few random words,
   at least 12 characters), and keep it in a password manager. The line it
   prints, starting `scrypt:`, is the hash: it goes in `cloud-homelab`'s
   `terraform.tfvars`.
2. Follow the `cloud-homelab` runbook. In short: a first, targeted apply
   creates the image repository; merging this repo's PR runs the workflow,
   which pushes the first image and stops with a notice that the function
   doesn't exist yet; a second apply creates the function and its URL;
   then **Run workflow** once more, which should go green.
3. Open the URL (`terraform output -raw maplenote_url` in `cloud-homelab`,
   or the workflow's summary) in Chrome. It opens Maplenote's sign-in
   page; enter your password. Chrome stays signed in for 30 days. To sign
   out, open `<url>/logout`.
   From a script: `curl -u any:<password> <url>api/files`.

## Changing the password

Make a new hash (step 1), replace the line in `cloud-homelab`'s
`terraform.tfvars`, plan and apply. The plan shows one change to
`aws_lambda_function.maplenote` (the value itself is hidden as
"sensitive"). Every signed-in browser is signed out, because sessions are
signed with the password's hash.

## Rolling back

Images are tagged with their commit and the last 5 are kept. To run an
older one (admin profile, one line; replace `<commit>` with a full commit
ID from `git log`):

```sh
aws lambda update-function-code --function-name cwa-maplenote --image-uri "$(aws ecr describe-repositories --repository-names cwa-maplenote --query 'repositories[0].repositoryUri' --output text --profile cwa-sandbox-admin):<commit>" --profile cwa-sandbox-admin
```

The next merge deploys the newest code again.

## Logs

CloudWatch log group `/aws/lambda/cwa-maplenote` (kept 14 days): one line
per request from gunicorn, plus any errors. From the Chromebook:

```sh
aws logs tail /aws/lambda/cwa-maplenote --since 1h --profile cwa-sandbox-claude
```

## When it fails

| Where | Message | Meaning |
|---|---|---|
| Sign in to AWS | `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Not run from `main` |
| Sign in to the image registry, or push | `AccessDenied`, `RepositoryNotFoundException` | The first targeted apply hasn't run, or the deploy role's ECR permissions don't match |
| Build and push (or the `tests` image job) | `429 Too Many Requests … Data limit exceeded` from `public.ecr.aws` | AWS's public registry ran out of its anonymous download allowance for that runner's IP address (shared with everyone on GitHub). Not the code: re-run the job. See ROADMAP "Known limitations" |
| Point the function | notice "The Lambda function doesn't exist yet" (green) | Expected before the second apply |
| Check the app answers | `answered 403` | The app refused the URL's host name: check `MAPLENOTE_ALLOWED_HOSTS` in the Terraform |
| Check the app answers | `answered 502` or `000` | The app didn't start: check the logs (a missing password hash says "Refusing to run on AWS Lambda") |
| Check the app answers | `answered 200` | **The app isn't asking for a password.** Treat as urgent: check `MAPLENOTE_PASSWORD_HASH` |
| Check the app answers | fails just after `Build record: …` | The live app isn't this commit's image: the function update didn't take, or `build.json` is missing from the image (check the `Dockerfile`) |

In the browser: a 413 "too large" on save means the file is over 5 MB,
Lambda's limit (10 MB locally).
