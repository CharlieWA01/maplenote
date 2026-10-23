# 2026-10-23: Getting the repo ready to go public

## Goal
Make the `production` environment's approval possible (it needs a public
repo on Charlie's plan) without publishing anything private.

## What was done
1. Scrubbed every commit on every branch (`git log --all -p`) for 12-digit
   numbers, email addresses, AWS sign-in and function URLs, access keys,
   GitHub tokens, private keys and password hashes; then the issues, PRs
   and their comments through the API. Nothing private: the 12-digit
   numbers are test data (`222222222222`, and the like in the CodeMirror
   bundle), the only addresses are `noreply` ones and the CodeMirror
   author's, and the only `lambda-url` text is the generic suffix.
2. Read a deploy-sandbox log the way a stranger would. The "Sign in to AWS"
   step prints `role-to-assume: arn:aws:iam::<full sandbox account ID>:…`,
   and the check step prints the function's address. Every past run does.
3. Moved the role ARNs (and prod's distribution ID) to secrets, masked the
   function addresses, and gave deploy-prod a separate switch
   (`PROD_DEPLOY_ENABLED`), since a job's `if:` can't read a secret.
4. Wrote `docs/runbooks/go-public.md`: set the secret, merge, check a
   log, delete the old runs, then flip the visibility and add the
   reviewer.

## Problems and fixes
- **The approval design needed a public repo.** Missed on 2026-10-22:
  GitHub's environment reviewers and branch rules are only for public
  repos below Enterprise. Charlie found it while following the runbook.
- **Masking happens too late for the role ARN.**
  `mask-aws-account-id: true` masks the account ID only after the action
  has printed its own inputs. Secrets are masked from the start.
- **Found on the way: the public `portfolio` repo's deploy logs already
  show the prod account ID and the landing page's distribution ID**, for
  the same reason. Reported to Charlie (a separate fix in that repo).

## How it was verified
- The scrub commands' output: no matches beyond the ones listed above.
- After Charlie sets the secret and merges: the next deploy-sandbox log
  shows `role-to-assume: ***`, and its check step prints `***` for the
  address.
- `python -m pytest` passes (no app code changed).

## Cost impact
None. Public repos' Actions minutes are free.
