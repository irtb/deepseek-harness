# Agent Note: Add a fail-closed ShotGo deployment baseline

Status: implemented

English | [中文](2026-08-24-shotgo-agent-deployment-baseline.zh.md)

## Problem

The `agent.shotgo.cn` DNS record now targets the shared `ve-shotgo` production server, but the server has active Laravel workers, an active Reverb process, and a locally modified Laravel worktree. The Agent Runtime has no production listener, Node runtime, service unit, dedicated certificate, or health contract. Deploying the Phase 0A smoke executable or changing shared services would create false readiness and unnecessary production risk.

## Decision

Add a standalone deployment baseline inside the ShotGo product boundary. The Gateway binds only to loopback, exposes liveness separately from readiness, requires an immutable deployment ID, and keeps readiness closed unless traffic is explicitly enabled. Provide versioned environment, systemd, and Nginx templates that use a dedicated service account, release symlink, port, certificate, and log files.

The initial deployment is contract-only. It does not expose Agent Session routes or connect Laravel, inference, billing, generation, or canvas mutation. Existing PHP, Redis, Supervisor, Laravel repositories, workers, and Reverb are out of scope. HTTPS installation follows a backup, `nginx -t`, separate certificate, and reload sequence.

## Consequences

Infrastructure can prove DNS, TLS, process supervision, loopback routing, rollback layout, and observability without claiming the product is ready. `/healthz` may return 200 while `/readyz` intentionally returns 503. Public traffic remains closed until Laravel protocol integration and end-to-end acceptance are complete.

## Alternatives considered

- Deploy the Phase 0A CLI under Supervisor: rejected because it is a one-shot smoke executable, not a network service.
- Bind Node directly to a public port: rejected because TLS, request limits, and public exposure belong at Nginx.
- Reuse the existing Laravel certificate: rejected because its SAN set does not include `agent.shotgo.cn` and expanding it couples unrelated sites.
- Enable readiness with mocked integrations: rejected because it would advertise a service that cannot execute accepted business operations.
