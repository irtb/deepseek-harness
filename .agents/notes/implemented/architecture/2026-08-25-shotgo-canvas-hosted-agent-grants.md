# Agent Note: Authorize Canvas-hosted Agent sessions with scoped Grants

Status: implemented

English | [中文](2026-08-25-shotgo-canvas-hosted-agent-grants.zh.md)

## Problem

The Agent interface runs inside `canvas.shotgo.cn`, which already authenticates users to Laravel with Sanctum. A separate handoff ticket would duplicate that authenticated entry path, while forwarding the account-wide Sanctum token to `agent.shotgo.cn` would give the independent Runtime more authority than one Agent Session needs. An opaque Grant also cannot safely authorize a Session when the Runtime checks only a user identity: the same user may work in personal and team spaces or in several projects.

## Decision

The Canvas browser uses its existing Sanctum bearer token to call `POST /api/agent/v1/grants`. Laravel derives `userId` and nullable `teamId` from the authenticated principal, validates the requested space, nullable project, Agent mode, and current inference-model availability, and returns a short-lived opaque Grant. The request body contains no user or team identity. Personal contexts retain `teamId: null` instead of fabricating a team. Personal accounts use the existing enabled inference-model source and the same logical DeepSeek models as team accounts; team contexts additionally apply the existing team authorization filter.

The Agent Runtime sends the opaque Grant, requested Session id, and one required operation capability to `POST /api/internal/agent/v1/grants/introspect` under service authentication. Laravel returns a no-store authorization result with a stable `authorizationContextId` that binds user, nullable team, space, nullable project, Agent mode, and Session, plus the approved inference route. The Runtime neither decodes the Grant nor persists or logs it.

Message submission, event reading, and cancellation use distinct capabilities. A live Gateway Session accepts a refreshed Grant only when introspection returns the same authorization context; matching user identity alone is insufficient. Gateway CORS admits only the configured Canvas origin, supports the bearer and replay preflight headers, and does not enable browser cookie credentials.

The production Gateway boots the restricted Harness Runtime, mounts one trusted mode Preset per authorized Session, and installs Laravel introspection before exposing Session routes. Its deploy build emits a separate compiled Cordis configuration so production never loads TypeScript source through Node's strip-only loader.

## Alternatives considered

**Keep the single-use handoff ticket.** Rejected because the browser does not leave the authenticated Canvas application; a second identity transfer adds expiry and replay state without crossing an application boundary.

**Send the Sanctum token directly to Agent Gateway.** Rejected because an account token can authorize unrelated ShotGo APIs and would expand the impact of Gateway, log, or plugin compromise.

**Validate a self-contained Grant locally.** Rejected because revocation, membership, model authorization, and project access remain Laravel-owned and may change before token expiry.

**Bind a Session only to user id.** Rejected because one user can hold unrelated personal, team, space, and project contexts. A user-only comparison permits cross-context Session reuse.

## Consequences

Canvas reuses its existing login and avoids a second frontend authentication system. Agent Gateway receives only Session-scoped authority and fails closed when Laravel, the required capability, inference route, or exact authorization context is unavailable. Every interactive Gateway request adds one Laravel introspection call; Laravel availability and latency therefore participate in Session admission, and caching cannot weaken revocation or expiry semantics.
