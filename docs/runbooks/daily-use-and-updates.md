# Runbook: daily use, updates and testing a pull request

All commands run in the Chromebook's Linux terminal.

## Start Maplenote

```bash
cd ~/maplenote
source .venv/bin/activate
python app.py
```

Open **http://localhost:8000** (not `penguin.linux.test`, where saving
device files doesn't work). Stop the server with `Ctrl+C`.

## Use the hosted copy instead

Nothing to start: open the AWS address in Chrome and sign in. It's
updated after each merge, once you approve the deploy. Details, including
where to find the address: `docs/runbooks/deploy.md`.

## Get the latest version after a merge

```bash
cd ~/maplenote
git switch main
git pull
```

Restart the server (`Ctrl+C`, then `python app.py`) and hard-refresh the
page with **Ctrl+Shift+R** so the browser loads the new code.

If `requirements.txt` changed in the update, run
`pip install -r requirements.txt` first (with `.venv` active).

## Run the tests

```bash
cd ~/maplenote
source .venv/bin/activate
python -m pytest
```

First time only: `pip install -r requirements-dev.txt` and
`python -m playwright install chromium`. GitHub runs the same tests on every
PR; the result shows as the **tests** check on the PR page.

## Try a pull request before merging

```bash
cd ~/maplenote
git fetch                       # learn about new branches on GitHub
git switch <branch-name>        # shown at the top of the PR page
python app.py                   # Ctrl+C the running one first
```

Hard-refresh, test, then go back with `git switch main`. To pick up fixes
pushed to the PR while you're testing: `git pull` while on the branch.

## Merge a pull request

On the PR page: check **Files changed**, then **Merge pull request** →
**Confirm merge** → **Delete branch**. Then "Get the latest version" above.
After the merge, the `docs-history` workflow adds a commit to `main`
recording the PR in `docs/HISTORY.md`; `git pull` brings it down.

## Upgrade a bundled library (CodeMirror, markdown-it)

Needs Node.js; usually done by Claude in a cloud session. See
`vendor-src/README.md`.
