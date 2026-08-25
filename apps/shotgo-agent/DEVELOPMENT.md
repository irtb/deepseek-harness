# ShotGo Agent Development Workflow

English | [中文](DEVELOPMENT.zh.md)

Every independently reviewable change uses a new branch. Before creating it, switch to the designated base branch, confirm the worktree is safe to change, and fast-forward from that branch's configured remote with `git pull --ff-only`. Create the development branch only from that updated base; use a specifically designated `release/*` branch only when the user chooses it. Never develop directly on a protected branch, and never start from a stale local base.

Use `feature/<scope>`, `fix/<scope>`, `docs/<scope>`, or `chore/<scope>`. Keep one concern per branch and keep all ShotGo product changes inside the product boundary documented in `AGENTS.md`.

Before implementation, map the requested behavior to every shared module, contract, caller, background job, database path, and sibling Agent that could be affected. Keep the diff inside the intended ownership boundary. Before handoff, run focused checks for the requested behavior and regression checks for each identified consumer, plus applicable typecheck, contract tests, lint, translation and Agent Note checks, upstream-isolation verification, and `git diff --check`. A skipped, unavailable, flaky, or failing required check blocks handoff.

There is no standing second-confirmation gate. When the user's current request includes merge, push, or deployment, the Agent may complete the named sequence after all required checks pass. A request limited to development, diagnosis, review, or status does not implicitly authorize a production mutation. Preflight remote branches before pushing, preserve the exact tested result during promotion, and stop on remote movement or an unexpected target instead of overwriting or substituting it. Automated deployment is allowed within the current task's scope; record the deployed commit or artifact, affected services, health checks, and rollback result, and never restart or deploy unrelated services.

## Database and table changes

Database and table mutations do not require a mandatory second confirmation and are not restricted to manual execution. Before applying them, prominently report the exact migration or SQL, affected schemas and tables, expected row or schema changes, dependent services and code paths, compatibility risks, validation queries, and backup or rollback procedure.

Validate migrations and data changes against a local database when one is available, including forward migration, affected application behavior, and rollback or compensating recovery. A failed or incomplete required local validation blocks production execution unless the task explicitly establishes a different verified staging path.

The Agent may execute production DDL, DML, migrations, imports, or copies only when the current request authorizes the associated production change and the risk report, backup or rollback path, and required validation are complete. Apply the narrowest operation, verify schema and data invariants immediately, and check every identified dependent service. Never use a database change requested for feature A to rewrite unrelated B or C data.

## Required handoff evidence

- source branch and base branch;
- reviewed source commits, integration branch, production branch, and production remote;
- exact checks and results;
- any warning or deferred acceptance item;
- identified affected consumers and their regression results;
- database risk report, local or staging validation, execution result, and rollback status when applicable;
- deployed commit or artifact, affected services, health checks, and rollback status when deployment is requested.
