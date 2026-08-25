# Agent Note: Human-confirmed production release

Status: implemented

English | [中文](2026-08-25-human-confirmed-production-release.zh.md)

## Problem

ShotGo development needs automated verification and Agent-operated repository steps without allowing an initial implementation request to authorize a production release. A failed or stale test result must not lead to a merge, and pushing a production branch must not let the Agent operate the production server.

## Decision

Each independently reviewable item starts on a new branch from the synchronized designated base. After every applicable automated check passes, the Agent preflights the remote branch topology and reports the reviewed source, integration branch, production branch, production remote, and exact results, then stops. One second explicit user confirmation scoped to those identifiers authorizes the complete Git release sequence: merge and push the integration branch, then promote that exact result and push the production branch. Separate Git operations do not create additional confirmation gates.

If a named branch is unusable or moves after confirmation, the Agent stops instead of selecting a substitute. It synchronizes the development branch, reruns affected checks, and presents a new complete proposal because the confirmed identifiers are no longer current. A skipped, unavailable, flaky, or failing required check blocks merge authorization.

The production-branch push ends the Agent-operated release path. The Agent provides exact production server deployment, verification, and rollback commands tied to the resulting commit SHA, while the user runs those commands manually. Database and table mutations retain their separate preview, local-validation, confirmation, and user-executed production workflow.

## Alternatives considered

**Let the user merge every branch manually.** Rejected because the user wants the Agent to perform the mechanical merge and production-branch push after reviewing test evidence and issuing a second confirmation.

**Request separate confirmations for the integration and production pushes.** Rejected because the user approves one fully disclosed release sequence, not each mechanical Git operation independently.

**Treat the development request as release authorization.** Rejected because it removes the deliberate checkpoint between verified code and a production-branch mutation.

**Let the Agent deploy after pushing the production branch.** Rejected because repository publication and production server mutation have different risk and recovery properties. The production operator retains control of server pull, build, migration, restart, and deployment commands.

## Consequences

The workflow has one explicit release-confirmation pause after verification. A remote race invalidates that proposal rather than silently widening it, but an unchanged proposal never asks for multiple confirmations. In return, the Agent can complete deterministic repository operations without gaining standing permission to release unreviewed code or operate production infrastructure.

Every handoff records the reviewed source, target, remote, checks, confirmation, and result SHA. Deployment instructions remain auditable and copyable, while execution stays under human control.
