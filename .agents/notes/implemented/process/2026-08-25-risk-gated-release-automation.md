# Agent Note: Risk-gated release automation

Status: implemented

English | [中文](2026-08-25-risk-gated-release-automation.zh.md)

## Problem

ShotGo needs fast repository and production workflows without allowing a narrow feature change to regress shared Agents, services, contracts, jobs, or data. Mandatory second confirmations and manual-only production operations add repeated pauses but do not themselves prove that a change to A is safe for B and C.

The workflow still needs to distinguish requested implementation from authorization to mutate production. Database and table changes need especially visible risk analysis because schema and data compatibility failures can affect several applications that share the same database.

## Decision

Every independently reviewable item starts on a new branch from the synchronized designated base and stays within one concern. Before implementation, the Agent maps the requested behavior to shared modules, contracts, callers, background jobs, sibling Agents, services, and data paths. Verification covers the requested behavior and every identified consumer; a skipped, unavailable, flaky, or failing required check blocks merge or release.

There is no standing second-confirmation gate for merge, push, deployment, or database execution. When the current user request includes an operation, the Agent may complete it after the applicable checks and safety preconditions pass. A request limited to development, diagnosis, review, or status does not authorize production mutation. Remote movement, an unexpected branch, destructive ambiguity, or a scope change still stops execution rather than widening authority.

Deployment records the exact commit or immutable artifact, affected services, health checks, and rollback result and does not restart unrelated services. Database and table work prominently reports the exact operation, affected schemas, tables, rows, dependent services and code paths, compatibility risks, backup, rollback, and validation. It uses local or staging validation when available, applies the narrowest authorized production operation, then immediately verifies schema, data, and dependent-service invariants.

## Alternatives considered

**Require a second confirmation before every release sequence.** Rejected because a disclosed, tested operation already within the current request does not become safer merely through a repeated approval. Remote and scope checks remain mandatory.

**Require users to perform every production deployment and database operation manually.** Rejected because execution ownership does not replace automated checks, immutable identity, backup, rollback, or post-change verification. Agent execution is permitted only inside the current task's authorization.

**Treat every development request as production authorization.** Rejected because implementation and production mutation remain different scopes. The user must request the release or deployment, but no special repeated phrase is required.

**Test only the directly changed feature.** Rejected because ShotGo shares runtime components, contracts, queues, model configuration, and database state. Every identified consumer needs proportional regression evidence.

## Consequences

Routine authorized releases can proceed without artificial confirmation pauses, and automation may include production deployment and database execution. The Agent must spend more effort before implementation identifying affected consumers and must retain auditable risk, identity, verification, and rollback evidence.

An operation stops when its authorization or target is ambiguous, but not solely because it lacks a prescribed confirmation phrase. Database warnings remain prominent even when execution is automated, and a change is incomplete when B or C regression paths identified during analysis remain untested.
