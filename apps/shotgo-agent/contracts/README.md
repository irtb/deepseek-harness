# Laravel Agent Protocol v1

English | [中文](README.zh.md)

Status: **frozen for implementation** on 2026-08-24. Wire version: `2026-08-24`.

This directory is the authority for the Agent Runtime ↔ ShotGo Laravel boundary. `openapi.json` defines HTTP operations; `schemas/laravel-v1.schema.json` defines shared messages; `src/contracts/laravel-v1.ts` mirrors stable runtime types and invariants. Laravel and Agent Runtime changes that affect the wire format must update these artifacts and contract tests together.

## Ownership and call paths

Harness calls a text/reasoning inference model only through Laravel's internal inference stream. Image, video, audio, and business text generation are never inference calls: model-visible tools submit those operations through Laravel capability endpoints. Laravel remains authoritative for provider routing, keys, permissions, quote expiry, credits, jobs, assets, refunds, and canvas state.

The browser first obtains a single-use handoff ticket from its authenticated Laravel session. Agent Runtime exchanges that ticket using service authentication and receives an opaque, short-lived capability grant. The runtime forwards the grant as a bearer token and never treats locally decoded claims as authority.

## Frozen conventions

- Base path: `/api/agent/v1`; internal inference: `/api/internal/agent/v1`.
- Every response carries `X-ShotGo-Protocol-Version: 2026-08-24`.
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
- inference SSE stream for Harness reasoning;
- generation quote, create, status, recovery lookup, and cancel;
- canvas snapshot and optimistic operation application;
- replayable Agent event stream.

This freeze does not claim the Laravel implementation already exists. It is the acceptance contract that both implementations must satisfy before enabling real writes or billing.
