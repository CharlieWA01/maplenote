# History

Every change merged into `main`, oldest first. The `docs-history` workflow
appends a row after each merged pull request; don't edit rows by hand. The
story behind each change is in `docs/journal/`. See `docs/DOCS-STANDARD.md`.

| Date | Change | Title |
|---|---|---|
| 2026-10-17 | commit `741a8b9` | Step 1: Flask server and a bare browser editor (committed straight to `main`) |
| 2026-10-17 | commit `4c61fbf` | Step 2: file sidebar, tabs and scratch pad (committed straight to `main`) |
| 2026-10-17 | [#1](https://github.com/CharlieWA01/maplenote/pull/1) | Add project memory: CLAUDE.md, roadmap and decision log |
| 2026-10-17 | [#2](https://github.com/CharlieWA01/maplenote/pull/2) | Add "Open…" to edit files from anywhere on the device |
| 2026-10-18 | [#3](https://github.com/CharlieWA01/maplenote/pull/3) | Add autosave, crash recovery and conflict detection |
| 2026-10-18 | [#4](https://github.com/CharlieWA01/maplenote/pull/4) | Switch the editing area to CodeMirror 6 |
| 2026-10-18 | [#5](https://github.com/CharlieWA01/maplenote/pull/5) | Add a Markdown preview for .md files |
| 2026-10-19 | [#6](https://github.com/CharlieWA01/maplenote/pull/6) | Adopt a shared documentation standard, backfill the record, automate it |
| 2026-10-19 | [#7](https://github.com/CharlieWA01/maplenote/pull/7) | Decide hosting: a Docker image running on AWS Lambda |
| 2026-10-19 | [#8](https://github.com/CharlieWA01/maplenote/pull/8) | Add an automated test suite, run on every PR |
| 2026-10-19 | [#9](https://github.com/CharlieWA01/maplenote/pull/9) | Add a storage layer: local folder or S3 |
| 2026-10-19 | [#10](https://github.com/CharlieWA01/maplenote/pull/10) | Record that Lambda packaging stays a Docker image |
| 2026-10-19 | [#11](https://github.com/CharlieWA01/maplenote/pull/11) | Add an AWS sandbox check: storage tests against the real S3 bucket via OIDC |
| 2026-10-19 | [#12](https://github.com/CharlieWA01/maplenote/pull/12) | Fix the real-S3 access test (NoSuchKey vs AccessDenied) |
| 2026-10-19 | [#13](https://github.com/CharlieWA01/maplenote/pull/13) | Package Maplenote as a Docker image for Lambda, behind a password |
| 2026-10-19 | [#14](https://github.com/CharlieWA01/maplenote/pull/14) | Sign in on a page instead of the browser's sign-in box |
| 2026-10-19 | [#15](https://github.com/CharlieWA01/maplenote/pull/15) | Docs: Maplenote is live on Lambda |
| 2026-10-19 | [#16](https://github.com/CharlieWA01/maplenote/pull/16) | Docs review: Maplenote is hosted on AWS, not only local |
| 2026-10-19 | [#17](https://github.com/CharlieWA01/maplenote/pull/17) | Drop the "In my own words" journal section |
| 2026-10-19 | [#18](https://github.com/CharlieWA01/maplenote/pull/18) | Plan the portfolio guest mode |
| 2026-10-19 | [#19](https://github.com/CharlieWA01/maplenote/pull/19) | Guest mode: notes kept in the visitor's browser, no login |
| 2026-10-19 | [#20](https://github.com/CharlieWA01/maplenote/pull/20) | Show the version, build and changelog in an About box |
| 2026-10-19 | [#21](https://github.com/CharlieWA01/maplenote/pull/21) | Note the public-registry 429 that can fail image builds |
| 2026-10-21 | [#22](https://github.com/CharlieWA01/maplenote/pull/22) | Finish Version 1: sign out, shortcuts, guest .zip download (1.0.0) |
| 2026-10-21 | [#23](https://github.com/CharlieWA01/maplenote/pull/23) | Get the app ready for CloudFront with OAC (prod move, step A) |
| 2026-10-21 | [#24](https://github.com/CharlieWA01/maplenote/pull/24) | Add deploy-prod (approval-gated) and stop the public-registry 429 |
| 2026-10-23 | [#25](https://github.com/CharlieWA01/maplenote/pull/25) | Get ready to go public: role ARNs as secrets, masked addresses |
| 2026-10-23 | [#26](https://github.com/CharlieWA01/maplenote/pull/26) | docs: Maplenote is live in prod |
| 2026-10-23 | [#27](https://github.com/CharlieWA01/maplenote/pull/27) | Remove deploy-sandbox; one runbook for prod deploys |
