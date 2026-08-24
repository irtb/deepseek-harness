# ShotGo Agent Development Workflow

English | [中文](DEVELOPMENT.zh.md)

Every independently reviewable change uses a new branch. Create it from the current local `master`, or from a specifically designated `release/*` branch when preparing a release. Never develop directly on either protected branch.

Use `feature/<scope>`, `fix/<scope>`, `docs/<scope>`, or `chore/<scope>`. Keep one concern per branch and keep all ShotGo product changes inside the product boundary documented in `AGENTS.md`.

Before merging, run the focused typecheck, unit/contract tests, lint, translation and Agent Note checks when applicable, upstream-isolation verification, and `git diff --check`. A skipped, unavailable, flaky, or failing required check blocks the merge.

After all gates pass, merge locally into `master` or the designated `release/*` branch with a non-fast-forward merge. Pushing, opening a pull request, deployment, and branch deletion remain separate actions and require explicit user authorization.

## Required handoff evidence

- source branch and base branch;
- commits included in the merge;
- exact checks and results;
- any warning or deferred acceptance item;
- whether the merge, push, or deployment occurred.
