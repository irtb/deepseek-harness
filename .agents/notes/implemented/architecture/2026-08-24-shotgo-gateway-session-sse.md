# Agent Note: Add authenticated ShotGo Gateway Sessions and SSE replay

Status: implemented

English | [中文](2026-08-24-shotgo-gateway-session-sse.zh.md)

## Problem

The Harness loop can execute a keyless conversation, but a browser needs a stable way to submit an identified message, reconnect without duplicating visible output, and cancel an active turn. Exposing raw Cordis events or trusting caller-supplied Session ids would couple the browser to framework internals and let an opaque Capability Grant reach a Session without authoritative claim validation.

## Decision

The Agent Gateway exposes a versioned browser protocol separate from the Laravel control-plane protocol. A message submission requires a Capability Grant plus matching `Idempotency-Key` and `clientRequestId`, returns one stable `runId`, and schedules one Harness follow-up. Repeating the same Session and request id returns that run without another turn; a second request while the Session is active fails with `SESSION_BUSY`.

`HarnessGatewaySessionService` is the Host Plane adapter around the public Agent Registry and Session services. Its injected `GatewaySessionAuthorizer` asks Laravel to validate the opaque Grant, requested Session id, and operation-specific capability and to return the authoritative authorization context, Agent mode, provider, model, and output limit. The context binds user, nullable team, space, nullable project, mode, and Session, so a live Session rejects another context even for the same user. The production entry point mounts this Authorizer and the trusted Agent Presets; traffic and readiness remain closed when Laravel introspection or inference configuration is unavailable rather than relying on locally decoded claims or the inference-policy allowlist alone.

The Canvas application is the only browser origin admitted by Gateway CORS. Preflight permits bearer authorization plus content, idempotency, and replay headers without enabling cookie credentials; responses expose both protocol-version headers.

The Gateway projects Harness events into replayable SSE frames. Each frame has a monotonic process-local Gateway cursor and retains the original Harness `sessionSeq`; the two counters never substitute for each other. A 512-event in-memory window supports `Last-Event-ID` replay and returns `SSE_CURSOR_EXPIRED` when the requested prefix is unavailable. A run ends with exactly one projected `run.completed`, `run.cancelled`, or `run.failed` event. Cancellation requests abort the active Harness turn, while the terminal event remains authoritative because cancellation can race with completion.

The canonical transcript remains the persisted Harness Session log. The in-memory cursor projection does not claim restart durability, so production readiness across restarts requires a recovery adapter that reconstructs Gateway delivery from persisted events.

## Verification

The keyless composition test mounts the real ShotGo Runtime, submits a message through `HarnessGatewaySessionService`, observes the tool call, tool result, assistant message, terminal run event, cursor replay, idempotent duplicate response, and cross-context denial. HTTP tests pin the `202` response, Gateway version header, SSE wire frames, `Last-Event-ID`, traffic-disabled response, strict Canvas-origin preflight, and idempotency rejection. The OpenAPI test pins capability authentication on submission, streaming, and cancellation and excludes provider credentials from the browser protocol.

## Alternatives considered

**Return an SSE stream directly from the message POST.** Rejected because native browser `EventSource` reconnects only with GET and `Last-Event-ID`; separating acceptance from delivery gives submission an idempotent response and replay an independent lifecycle.

**Use Harness `sessionSeq` as the SSE cursor.** Rejected because the Gateway also emits run lifecycle events that are not Harness Session records. Combining the counters would make gaps and recovery ambiguous.

**Decode Capability Grant claims locally.** Rejected because Laravel owns grant validation, revocation, team and project membership, Agent mode, and model policy. A local decode would create a second authorization authority and could not safely bind the requested Session.

**Open production routes using inference policy as authorization.** Rejected because that endpoint proves only the grant's inference capability and allowlist; it does not return enough authoritative identity to bind a browser request to a Session, project, or Agent mode.

## Consequences

Browser transport, Harness execution, replay, and cancellation can evolve behind one product-owned Host Plane interface without changing upstream packages. The protocol gains distinct run and cursor identifiers plus bounded replay state. Production Session traffic depends on Laravel Grant issuance and introspection acceptance, and process restart recovery remains explicit work rather than an accidental promise.
