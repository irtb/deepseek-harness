# Laravel Agent Protocol v1

English | [中文](README.zh.md)

Status: **Phase 0B.3 frozen for implementation** on 2026-08-25. Wire version: `2026-08-25.1`.

This directory is the authority for the Agent Runtime ↔ ShotGo Laravel boundary. `openapi.json` defines HTTP operations; `schemas/laravel-v1.schema.json` defines shared messages; `src/contracts/laravel-v1.ts` mirrors stable runtime types and invariants. Laravel and Agent Runtime changes that affect the wire format must update these artifacts and contract tests together.

## Ownership and call paths

Harness calls the Laravel-approved `deepseek-v4-flash` or `deepseek-v4-pro` reasoning model directly through Volcano Ark. Laravel encrypts the provider credential at rest and returns it with both provider endpoint IDs only to the service-authenticated Agent Runtime; the runtime retains the configuration in process memory and never exposes it to a browser, capability grant, session log, or usage report. Before inference the runtime reads an expiring model/budget policy using the user's capability grant, and after inference it reports idempotent metadata-only usage through service authentication. Image, video, audio, and business text generation are not Harness inference calls: model-visible tools submit those operations through Laravel capability endpoints. Laravel remains authoritative for policy, permissions, usage audit, quote expiry, credits, jobs, assets, refunds, and canvas state.

Completed generation responses may contain `assets`. Each item is an ownership-checked mirrored asset with only `assetId`, `kind`, public HTTP(S) `url`, and `sizeBytes`. A provider URL, raw provider response, unmatched storage row, manual upload, or private path must never be projected into this field.

The browser remains on `canvas.shotgo.cn` and uses its existing Sanctum bearer token to request an opaque, short-lived Capability Grant from Laravel. Laravel derives the user and nullable team identity from the authenticated principal, validates the requested space, project, Agent mode, and current inference-model availability, and never accepts `userId` or `teamId` from the browser body. A personal context carries `teamId: null`; it never uses a fabricated team identifier. Personal accounts use the existing enabled inference-model source and the same logical DeepSeek models as team accounts; team contexts additionally apply the existing team authorization filter. The Agent Runtime introspects the opaque Grant through a service-authenticated, no-store endpoint and never treats locally decoded claims as authority.

Laravel returns a stable `authorizationContextId` for one user, nullable team, space, nullable project, Agent mode, and Session binding. The Gateway requires distinct capabilities for message submission, event reading, approval response, and cancellation, and a refreshed Grant can access a live Session only when Laravel returns the same authorization context.

## Frozen conventions

- Base path: `/api/agent/v1`; service-authenticated control-plane writes: `/api/internal/agent/v1`.
- Every response carries `X-ShotGo-Protocol-Version: 2026-08-25.1`.
- `GET /api/internal/agent/v1/inference-runtime-config` requires service authentication, returns `Cache-Control: no-store`, and fails closed unless the encrypted credential and both distinct provider endpoint IDs are complete.
- Inference policy is short-lived and fail-closed. Its default model must be present in its allowlist.
- Inference usage uses `llmRequestId` as `Idempotency-Key` and contains only identifiers, model, timing, status, and token counters. Provider keys, prompts, messages, completions, and raw responses are forbidden.
- Generation configuration returns visible models, safe option constraints, and kind-specific defaults under `parameterSchemaVersion: 1`. Its credit fields are catalog metadata, not a quote or confirmation basis.
- Generation quote uses the current Capability Grant, performs no business write, and returns integer credits plus a short-lived opaque Quote Envelope. Quote requests do not use mutation context or an idempotency key; generation submission remains idempotent.
- Generation create sends only trusted mutation context, `quoteId`, and `quoteVersion`. Laravel revalidates the quote and account context, reserves `(user_id, client_request_id)` before charging, dispatches only after commit, and returns `replayed: true` for an identical retry; reuse with a different request returns `IDEMPOTENCY_CONFLICT`.
- Generation status and recovery lookup are read-only and require the same user, nullable team, authorization context, and Session that created the request. Cancellation uses a deterministic mutation key and one-shot UI approval; queued cancellation refunds, processing cancellation does not assume an upstream refund, and terminal state wins a completion race.
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

- Sanctum-authenticated Grant issuance, service-authenticated Grant introspection, and capability catalog;
- direct-inference policy read and metadata-only usage audit;
- generation quote, create, status, recovery lookup, and cancel;
- canvas snapshot and optimistic operation application;
- replayable Agent event stream.

Grant, inference, generation configuration, quote, confirmation, idempotent generation create, status, recovery lookup, and cancellation now have implementations on both sides. Asset projection and canvas writes remain acceptance contracts rather than completed capability paths. The removal of `/api/internal/agent/v1/inference/stream` is intentionally incompatible with wire version `2026-08-24`.
