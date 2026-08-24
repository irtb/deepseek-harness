# Agent Note: Keep ShotGo merges and database rollout user-owned

Status: implemented

English | [中文](2026-08-24-shotgo-user-owned-merges-and-database-rollout.zh.md)

## Problem

ShotGo development uses multiple contributors and more than one Git remote. Starting a branch from an unsynchronized local base can omit another contributor's accepted work, while an automatic local merge removes the user's final review point. Database changes carry a larger and less reversible risk because application tests alone do not prove that a production statement targets the intended schema, rows, or deployment window.

## Decision

Every independently reviewable ShotGo change begins by switching to its user-designated base, confirming the worktree is safe to change, and fast-forwarding from that branch's configured remote with `git pull --ff-only`. The Agent creates a new scoped development branch only after the update and never develops directly on `master` or `release/*`. A non-fast-forward or conflicting update stops for user direction rather than rewriting shared history.

The Agent completes applicable checks and prepares commits on the development branch, but never merges them into `master` or `release/*`, including locally. The handoff identifies the base, development branch, prepared commits, exact checks, warnings, and whether any separately authorized push or deployment occurred. The user owns the merge decision and action.

Every proposed database or table mutation is a two-step review. The Agent first provides exact migration or SQL, targets, expected schema or row impact, compatibility, validation queries, and backup or rollback procedure without executing DDL or mutating DML. The user reviews or edits the statements and manually applies them to the required local database deployment. The Agent may then run read-only verification and application tests against that local state.

Production database execution remains user-owned. Local acceptance produces an exact statement set or local-to-production copy procedure plus verification queries; the Agent does not execute production DDL, DML, migrations, imports, or copies. A second explicit confirmation is required before any database mutation workflow advances beyond its statement preview, and incomplete local validation blocks production handoff.

## Alternatives considered

**Create branches from the current local `master`.** Rejected because local state does not prove that another contributor's remote change has been incorporated.

**Let the Agent merge after tests pass.** Rejected because passing tests establish technical evidence, not the user's approval of branch history, review timing, or release scope.

**Run migrations directly in production after a local application test.** Rejected because it combines code and data release authority, skips review of the exact statements, and makes recovery depend on an unverified production operation.

**Allow the Agent to apply the approved statements to production.** Rejected because the user requires production database execution and local-to-production copying to remain manual, even after technical validation.

## Consequences

Each change starts from a current shared base and ends as a reviewable branch rather than an implicit merge. Database work takes an additional preview and local-validation cycle, but production mutations retain a clear human execution point, exact statements, rollback information, and post-change queries. The Agent can still perform read-only diagnosis and local application testing within granted scope, but it cannot use those actions to imply merge or production-write authority.
