# Agent Gateway Protocol v1

English | [中文](README.zh.md)

The browser-facing Gateway protocol is frozen at `2026-08-26.1`. [`gateway-v1.openapi.json`](../gateway-v1.openapi.json) defines message submission, optional scalar image/video generation intent, one-shot approval responses, run cancellation, and replayable Server-Sent Events (SSE); [`gateway-v1.ts`](../../src/contracts/gateway-v1.ts) owns the matching runtime types. This protocol is separate from the [Laravel control-plane protocol](../README.md), which remains at `2026-08-25.1`, so either interface can version without changing the other's header.

An optional `generationContext` records the model and scalar options selected in the Canvas UI. The Gateway requires its kind to match the Grant-bound Agent mode, rejects unknown or attachment-like fields, logs the deterministic selection with the user message, and applies only those selected scalar values to the next Laravel quote request while preserving the Agent's final prompt. Laravel remains authoritative for model availability, option validation, pricing, charging, and refunds. The confirmation prompt consumes one unexpired quote registry entry and reads its model, normalized parameters, and credits; model-authored display fields cannot affect the prompt or charge.

For a rolling release, Canvas `2026-08-26.1` sends `X-ShotGo-Gateway-Protocol-Version` on every Session request. The new Agent must be deployed first: it returns `2026-08-26.1` to an explicitly versioned client and projects `2026-08-25.1` for an undeclared legacy client. Unknown declared versions fail with `GATEWAY_PROTOCOL_UNSUPPORTED`; this compatibility response is removed only after the legacy Canvas build is no longer served or cached.

`approval.requested` exposes the Harness-audited pending decision to the owning Canvas Session. The browser answers it through the approval endpoint with `allowed-once` or `rejected`. The Gateway re-authorizes `agent.session.approval.respond`, binds the response to the live authorization context and Session, accepts an identical retry idempotently, and rejects a changed or stale decision. Model text is never treated as approval.

## Session and authorization

Every Session request carries an opaque Capability Grant as a Bearer token. A `GatewaySessionAuthorizer` validates the Grant, requested Session id, and operation-specific capability with Laravel, then returns the authoritative authorization context, Agent mode, and inference route before Harness creates or reads a Session. The stable context binds user, nullable team, space, nullable project, Agent mode, and Session; the in-process service rejects a different context even when the same user knows the Session id. The production Gateway mounts Session routes only with this authorizer and the trusted Agent Presets; health remains available while Session traffic fails closed.

Browser requests originate only from the configured Canvas origin. The Gateway answers its preflight without cookies, permits the authorization, content, idempotency, and replay headers, exposes both protocol-version headers, and rejects any other supplied Origin.

`POST /api/agent/v1/sessions/{sessionId}/messages` accepts one text message and requires `Idempotency-Key` to equal `clientRequestId`. Repeating the same `{sessionId, clientRequestId, message, generationContext}` returns the original `runId` without scheduling another Harness turn; reusing the key with changed content returns `IDEMPOTENCY_CONFLICT`. A Session permits one active run; concurrent submissions return `SESSION_BUSY`.

## SSE replay and cancellation

`GET /api/agent/v1/sessions/{sessionId}/events` streams ordered frames. The SSE `id` is a monotonic cursor local to that Gateway Session and is not a Harness `sessionSeq`, Laravel project event sequence, canvas revision, or business idempotency key. `Last-Event-ID` resumes after the last processed cursor. The in-memory replay window retains 512 events; a cursor older than that window fails with `SSE_CURSOR_EXPIRED` instead of silently skipping data.

Each Harness Session event is wrapped as `session.event` and retains its original `sessionSeq`. One of `run.completed`, `run.cancelled`, or `run.failed` terminates the stream for that run. `DELETE /api/agent/v1/sessions/{sessionId}/runs/{runId}` requests cancellation; its `202` response is not the final outcome, because cancellation can race with completion. The terminal SSE frame is authoritative for the Harness run, while Laravel remains authoritative for any business generation already submitted by a Tool.

Session persistence stores the canonical Harness log. Gateway replay is process-local delivery state; a production recovery adapter must rebuild its cursor projection from persisted Session events before readiness opens across process restarts.
