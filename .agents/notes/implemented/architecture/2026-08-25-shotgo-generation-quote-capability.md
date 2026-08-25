# Agent Note: ShotGo generation quote capability

Status: implemented

English | [中文](2026-08-25-shotgo-generation-quote-capability.zh.md)

## Problem

The generation catalog contains descriptive credit metadata, but a conversational Agent needs an authoritative, expiring Laravel quote before it asks the user to approve a charge. Reusing catalog values would bypass current model access, defaults, pricing rules, team context, and balance.

## Decision

The model-facing `generation_quote` tool is read-only. It accepts the completed image or video model and parameters; the Gateway injects the active Session's opaque Capability Grant and Session id. Laravel revalidates the current user, nullable team, project scope, Agent mode, and `generation.quote` capability, normalizes defaults, applies node-operation resolution, and invokes the existing `PricingService`.

Laravel returns integer credits, a breakdown, current balance, normalized parameters, and an expiry with a versioned encrypted Quote Envelope. The envelope binds the stable authorization context, user, nullable team, Session, Agent mode, generation kind, model, normalized parameters, credits, and a configuration fingerprint. Its expiry never exceeds the Grant expiry. Neither the endpoint nor the tool consumes credits, creates a generation record, writes a business log, or dispatches a job.

Quote is a read operation and does not carry mutation context or an idempotency key. The later generation submission remains idempotent, decrypts and revalidates the Quote Envelope, recomputes the quote, and requires another user confirmation if authorization, parameters, availability, or credits changed. The Agent presents the exact quote and expiry and treats model text as insufficient confirmation.

## Alternatives considered

**Use catalog credit metadata as the quote.** Rejected because catalog values do not represent the complete Laravel pricing calculation and may be stale.

**Persist every quote in a new database table.** Rejected for this phase because an authenticated encrypted envelope supplies integrity, scope, expiry, and later revalidation without a schema migration. A durable quote ledger can be introduced only if audit or reservation requirements demand it.

**Use the Agent service token for quotes.** Rejected because the active Capability Grant already supplies the least-privilege user and team authority, while a service token alone has process-wide scope.

## Consequences

Quote responses can be larger than ordinary opaque identifiers, so the protocol assigns opaque tokens an 8192-byte limit. The browser and Harness never decode a quote as authority. A key rotation invalidates outstanding quotes, which fails closed and requires re-quoting. The confirmation and submission phases must retain the envelope only for the active conversational action and must not log it as reusable authority.
