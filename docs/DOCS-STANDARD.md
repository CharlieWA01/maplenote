# Documentation standard

*Version 1 (2026-10-19). This file is identical in every project repo. To
change it, change it in one repo and copy it to the others in the same week.*

## Why we document

Every project keeps a record of **what was built, the decisions made, and
why**, written while it happens. The record serves:

- **Future me:** why is it like this? What did I try already?
- **Presentations and demos:** the story of the project, with real details.
- **Resume and job interviews:** concrete, true examples of problems solved,
  trade-offs made, and results, ready to talk about.
- **Claude:** Claude doesn't remember past sessions. The repo is the memory.

## The files

Every project has the same layout, so any of them can be picked up quickly.

| File | What it holds | Who writes it |
|---|---|---|
| `README.md` | What the project is and how to run it | Claude, kept current |
| `CLAUDE.md` | Briefing Claude reads at the start of every session | Claude, Charlie approves |
| `docs/PORTFOLIO.md` | One-page summary for presentations, resume and interviews | Claude drafts, Charlie edits |
| `docs/ROADMAP.md` | Done, next, parking lot of ideas, known limitations | Claude, each PR |
| `docs/DECISIONS.md` | Every real choice: decision, alternatives, trade-offs/cost, why | Claude, each PR |
| `docs/journal/YYYY-MM-DD-<topic>.md` | What happened in each work session | Claude |
| `docs/interview/README.md` | STAR stories drawn from the work | Claude drafts the facts; Charlie rehearses them |
| `docs/runbooks/` | Procedures that get repeated | Claude, when a procedure appears |
| `docs/HISTORY.md` | One line per merged PR: date, link, title | **Automatic** (GitHub Action) |
| `docs/DOCS-STANDARD.md` | This file | Change deliberately, copy everywhere |

## What every pull request updates

A change isn't done until its docs are updated **in the same PR**:

1. **Journal:** add or extend `docs/journal/YYYY-MM-DD-<topic>.md` (template
   in `docs/journal/README.md`).
2. **Decisions:** any real choice goes in `docs/DECISIONS.md`.
3. **Roadmap:** tick off what's done; park side ideas; note new limitations.
4. **Interview stories:** when something makes a good story (a problem
   solved, a trade-off, a mistake caught, a cost avoided), add or extend one.
5. **Runbooks:** if a procedure will be repeated, write it up.
6. **Portfolio:** when the project's headline facts change (a major feature,
   a milestone, a new number worth quoting), update `docs/PORTFOLIO.md`.

`docs/HISTORY.md` is the one file a PR never edits by hand.

## Formats

**Decisions** (`docs/DECISIONS.md`, newest at the bottom):

```markdown
## YYYY-MM-DD: <short title> (PR #n)
**Decision:** what was chosen.
**Alternatives:** what else was considered.
**Why:** the reasoning, including cost or trade-offs.
```

Optional extra lines: **Trade-offs**, **Cost**, **Rejected**, **Supersedes**.
A decision that changes is marked *superseded* with a pointer to the new
entry, never deleted.

**Journal** (`docs/journal/`): one file per work session or topic, using the
template in that folder's `README.md`: Goal, What was done, Problems and
fixes, How it was verified, and Cost or impact.

**Interview stories** (`docs/interview/README.md`): STAR format
(Situation, Task, Action, Result), each tagged with themes defined at the top
of that file. Keep them short enough to say in two minutes.

**History** (`docs/HISTORY.md`): a table row per merged PR, appended by the
`docs-history` workflow. Commits made straight to `main` before a project
used PRs are backfilled by hand once.

## Rules

- **Write plainly and explain the why.** Note the cost of every choice:
  money, time, complexity or risk.
- **Never rewrite history.** Correct old entries by marking them superseded.
- **Be honest about how the work was done.** Projects are built with Claude
  Code as a pair programmer: Charlie sets direction, makes the decisions,
  reviews every PR and tests on real hardware; Claude writes most of the code
  and drafts the docs. Portfolio and interview material says so plainly.
- **Sign Claude's GitHub comments.** Claude posts through Charlie's GitHub
  connection, so its PR and issue comments appear under Charlie's name.
  Claude ends each one with `— Claude` so the record shows who said what.
- **Privacy:** nothing in the docs that couldn't be public: no secrets, tokens,
  emails, private URLs or full account IDs (each project's `CLAUDE.md` lists
  its specifics). Repos may go public later as portfolio pieces.

## What's automated

| What | How |
|---|---|
| Claude writes the docs as part of every task | The **Documenting is part of every task** section of each repo's `CLAUDE.md`, which Claude reads at the start of every session |
| A checklist on every PR | `.github/pull_request_template.md` |
| PRs that change code or config must also change `docs/` | The `docs-check` workflow fails the PR otherwise (Markdown-only changes always pass). Add the label `no-docs-needed` for a genuine exception (e.g. a typo fix). |
| A complete timeline of merged PRs | The `docs-history` workflow appends a row to `docs/HISTORY.md` after each merge |

What stays manual, on purpose: rehearsing the interview stories out loud.

## Starting a new project

Copy from an existing repo: this file, `.github/pull_request_template.md`,
`.github/workflows/docs-check.yml`, `.github/workflows/docs-history.yml`,
`docs/journal/README.md`, and the "Documenting is part of every task"
section of `CLAUDE.md`. Then create an empty `docs/HISTORY.md` (copy the
header), `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/PORTFOLIO.md` and
`docs/interview/README.md` with the project's own interview tags.
