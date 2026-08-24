# ShotGo Agent Development Workflow

English | [中文](DEVELOPMENT.zh.md)

Every independently reviewable change uses a new branch. Before creating it, switch to the designated base branch, confirm the worktree is safe to change, and fast-forward from that branch's configured remote with `git pull --ff-only`. Create the development branch only from that updated base; use a specifically designated `release/*` branch only when the user chooses it. Never develop directly on a protected branch, and never start from a stale local base.

Use `feature/<scope>`, `fix/<scope>`, `docs/<scope>`, or `chore/<scope>`. Keep one concern per branch and keep all ShotGo product changes inside the product boundary documented in `AGENTS.md`.

Before handoff, run the focused typecheck, unit/contract tests, lint, translation and Agent Note checks when applicable, upstream-isolation verification, and `git diff --check`. A skipped, unavailable, flaky, or failing required check blocks handoff.

After all gates pass, leave the reviewed commits on the development branch for the user to merge manually. The assistant must not merge into `master` or `release/*`, including a local merge. Pushing, opening a pull request, deployment, and branch deletion remain separate actions and require explicit user authorization.

## Database and table changes

Database and table mutations require a second explicit user confirmation. First produce the exact migration or SQL, affected database and tables, expected rows or schema changes, validation queries, backup or rollback procedure, and application compatibility impact. Do not execute DDL or mutating DML while presenting this preview.

ShotGo databases and required tables must have a local deployment. The user reviews or edits the proposed statements and applies them to the local database. Afterward, the assistant may run read-only verification and application tests against that local state. A failed or incomplete local validation blocks production handoff.

Production database execution belongs to the user. After local acceptance, provide the exact reviewed statements or local-to-production copy procedure and verification queries; do not execute production DDL, DML, migrations, imports, or copies. Read-only production inspection also requires the authority already granted for that task and must not be used to bypass the mutation rule.

## Required handoff evidence

- source branch and base branch;
- commits prepared for the user's merge;
- exact checks and results;
- any warning or deferred acceptance item;
- database or table statement preview, local validation, and production handoff status when applicable;
- confirmation that no assistant-performed merge or production database mutation occurred.
