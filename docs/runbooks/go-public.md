# Runbook: making the repo public

Why: GitHub's "Required reviewers" on an environment (the approval in front
of `deploy-prod`) only works in public repos on Charlie's plan, and the repo
was always meant to be visible from the portfolio (DECISIONS.md,
2026-10-23). Once public, everything is public: the code, its whole
history, issues and PRs, and **every Actions run's log and summary**.

## What was checked (2026-10-23)

- Code and every commit on every branch: no account IDs, emails (only
  GitHub's and Anthropic's `noreply` addresses), sign-in URLs, keys,
  tokens or real password hashes. The only `lambda-url` text is the
  generic `.lambda-url.us-east-2.on.aws` suffix and test placeholders.
- Issues, PRs and their comments: nothing.
- **Actions logs: not clean.** `configure-aws-credentials` prints its
  inputs before it masks anything, so every deploy-sandbox and
  aws-sandbox-check run shows the full role ARN (with the sandbox account
  ID). deploy-sandbox's runs also print the sandbox function's address.

## Steps

1. **Turn the role ARN into a secret, before merging the PR that uses it.**
   Settings → Secrets and variables → Actions → **Secrets** → New
   repository secret: name `AWS_DEPLOY_ROLE_ARN`, value copied from the
   variable of the same name (Variables tab). Or in the terminal:

   ```sh
   cd ~/maplenote
   gh secret set AWS_DEPLOY_ROLE_ARN --body "$(gh variable get AWS_DEPLOY_ROLE_ARN)"
   ```

2. **Merge the PR** that switches the workflows to `secrets.` (the merge
   runs deploy-sandbox, which should pass). Then delete the old
   `AWS_DEPLOY_ROLE_ARN` *variable* (`gh variable delete AWS_DEPLOY_ROLE_ARN`).
3. **Check one new log:** Actions → deploy-sandbox → the latest run →
   "Sign in to AWS (sandbox)": `role-to-assume: ***`.
4. **Delete the old runs** that show the account ID: every deploy-sandbox
   and aws-sandbox-check run from before step 2 (Actions → the workflow →
   each run's **…** → Delete workflow run). Claude can do this for you
   once you say so; deleting runs can't be undone.
5. **Go public:** Settings → General → Danger Zone → **Change visibility**
   → Make public.
6. **Contributors from outside:** Settings → Actions → General → "Approval
   for running fork pull request workflows from contributors": choose
   **Require approval for all external contributors**. Forks never get the
   AWS roles (those trust only `main` or the `production` environment),
   but this keeps strangers from using the runners. (The setting only
   appears once the repo is public, hence this order.)
7. **The approval gate:** Settings → Environments → `production` → tick
   **Required reviewers**, add yourself, then under "Deployment branches
   and tags" choose **Selected branches and tags** and add `main`. Save.
   Then carry on with cloud-homelab's `docs/runbooks/maplenote-prod.md`,
   step 3.

## Done

All seven steps were done on 2026-10-23, and the first prod deploy
after them showed `***` for the account ID and the distribution ID.

## Afterwards

- Values that hold the account ID go in **secrets**, never variables, and
  never in a workflow's `run:` text: GitHub prints variables, and the
  expanded text of each `run:` step, in the public log.
- Public repos get GitHub Actions minutes for free.
