# Agent Note: ShotGo generation status and cancellation

Status: implemented

English | [中文](2026-08-25-shotgo-generation-status-cancel.zh.md)

## Problem

The Agent needs authoritative progress and cancellation without trusting model-invented state, crossing Session or team boundaries, refunding supplier work that may already be billable, or losing a cancellation/completion race.

## Decision

Laravel exposes Grant-bound status, recovery-by-client-request, and cancellation endpoints. Every request must match the generation log's user, nullable team, creating Session, and stable authorization context. The Gateway injects the current Grant; the model sees only the generation identifier. Cancellation derives a stable mutation key from Session and generation identifier and passes the same one-shot Harness approval channel as submission.

Laravel locks the generation row while cancelling. A queued request is refunded and marked cancelled before the worker can claim it. A processing request is marked cancelled but not automatically refunded because no provider cancellation/refund contract exists yet. If completion or another terminal state wins the lock first, that state is returned unchanged. Repeated cancellation returns the same authoritative terminal state.

## Alternatives considered

Polling or cancelling suppliers directly from Harness was rejected because Laravel owns provider credentials, credits, jobs, and refunds. Trusting a generation identifier alone was rejected because another Session of the same user could otherwise observe or cancel it. Automatically refunding processing work was rejected because the supplier may already have charged and no upstream refund was verified.

## Consequences

No schema migration is required; trusted Session and authorization metadata are stored inside the existing request parameters for newly submitted Agent generations. Requests created before this binding exists fail closed on Agent status access. Asset payloads remain withheld until the next asset-result phase defines stable ownership and URL semantics.
