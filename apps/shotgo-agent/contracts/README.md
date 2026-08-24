# Laravel Agent Protocol v1

English | [中文](README.zh.md)

Status: **Phase 0B.2 frozen for implementation** on 2026-08-24. Wire version: `2026-08-24.2`.

This directory is the authority for the Agent Runtime ↔ ShotGo Laravel boundary. `openapi.json` defines HTTP operations; `schemas/laravel-v1.schema.json` defines shared messages; `src/contracts/laravel-v1.ts` mirrors stable runtime types and invariants. Laravel and Agent Runtime changes that affect the wire format must update these artifacts and contract tests together.

## Ownership and call paths

Harness calls the Laravel-approved `deepseek-v4-flash` or `deepseek-v4-pro` reasoning model directly through Volcano Ark. Laravel encrypts the provider credential at rest and returns it with both provider endpoint IDs only to the service-authenticated Agent Runtime; the runtime retains the configuration in process memory and never exposes it to a browser, capability grant, session log, or usage report. Before inference the runtime reads an expiring model/budget policy using the user's capability grant, and after inference it reports idempotent metadata-only usage through service authentication. Image, video, audio, and business text generation are not Harness inference calls: model-visible tools submit those operations through Laravel capability endpoints. Laravel remains authoritative for policy, permissions, usage audit, quote expiry, credits, jobs, assets, refunds, and canvas state.

The browser first obtains a single-use handoff ticket from its authenticated Laravel session. Agent Runtime exchanges that ticket using service authentication and receives an opaque, short-lived capability grant. The runtime forwards the grant as a bearer token and never treats locally decoded claims as authority.

## Frozen conventions

- Base path: `/api/agent/v1`; service-authenticated control-plane writes: `/api/internal/agent/v1`.
- Every response carries `X-ShotGo-Protocol-Version: 2026-08-24.2`.
- `GET /api/internal/agent/v1/inference-runtime-config` requires service authentication, returns `Cache-Control: no-store`, and fails closed unless the encrypted credential and both distinct provider endpoint IDs are complete.
- Inference policy is short-lived and fail-closed. Its default model must be present in its allowlist.
- Inference usage uses `llmRequestId` as `Idempotency-Key` and contains only identifiers, model, timing, status, and token counters. Provider keys, prompts, messages, completions, and raw responses are forbidden.
- Every mutating request carries `Idempotency-Key`, equal to body `context.clientRequestId`.
- Mutation context contains `sessionId`, `runId`, `actionId`, and `clientRequestId`.
- Amounts are decimal strings plus ISO 4217 currency; JavaScript numbers are forbidden for money.
- Errors use `application/problem+json` with stable `code` and `retryable` fields.
- Unknown mutation outcomes are recovered through lookup by `clientRequestId`, never by blind resubmission.
- Canvas writes include `expectedRevision`; conflict returns `CANVAS_REVISION_CONFLICT` and requires reread/replan.
- Quote-bound generation includes `quoteId` and `quoteVersion`; an expired or changed quote requires a new user confirmation.
- Events use opaque `eventId`, monotonic per-project `sequence`, and `operationId`. SSE resumes with `Last-Event-ID`; consumers deduplicate by `eventId` and reconcile gaps from Laravel state.

## Lifecycle

Generation states are `draft → creating → queued → processing → completed`, with terminal `failed` and `cancelled`. Cancellation is accepted only before a terminal state and may race with completion; the returned Laravel status is final. Progress exposes stage and timestamps, not invented percentages.

## Endpoint groups

- handoff exchange and capability catalog;
- direct-inference policy read and metadata-only usage audit;
- generation quote, create, status, recovery lookup, and cancel;
- canvas snapshot and optimistic operation application;
- replayable Agent event stream.

This freeze does not claim the Laravel implementation already exists. It is the acceptance contract both implementations must satisfy before Agent readiness opens. The removal of `/api/internal/agent/v1/inference/stream` is intentionally incompatible with wire version `2026-08-24`.
