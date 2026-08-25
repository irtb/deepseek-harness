# Agent Note: ShotGo idempotent generation submission

Status: implemented

English | [中文](2026-08-25-shotgo-idempotent-generation-submit.zh.md)

## Problem

An approved generation may be retried because of browser, Gateway, HTTP, queue, or process failures. A retry must not charge twice, create two jobs, call the supplier twice, or silently reuse the same key for different parameters.

## Decision

`generation_submit` receives the opaque quote and trusted Session mutation context only after the Harness one-shot approval gate succeeds. The Gateway derives a stable 64-character `clientRequestId` from the Session and quote and sends it as both `Idempotency-Key` and `context.clientRequestId`.

Laravel revalidates the Capability Grant, authorization context, quote expiry, normalized parameters, current pricing fingerprint, model, provider, storage quota, and credit balance. In one database transaction it reserves the existing unique `(user_id, client_request_id)` request-log key before consuming credits, attaches the charge, and dispatches the job only after commit. An identical fingerprint replays the existing log; a changed fingerprint returns a conflict. The worker atomically claims `queued → processing`, and provider credentials are resolved from the request log's frozen nullable `team_id`, not the user's later active-team selection.

## Alternatives considered

Charging before reserving the request key was rejected because concurrent retries could both consume credits before one insert loses the unique-key race. A random key per tool execution was rejected because transport or process retries would become indistinguishable new purchases. A new idempotency table was unnecessary because the existing request-log unique index already provides the required reservation boundary.

## Consequences

No schema migration is required because the existing request-log unique index is reused. The current create response exposes a stable generation and operation identifier, state, charged credits, balance, and replay flag. Status, cancellation, and asset projection remain separate later phases.
