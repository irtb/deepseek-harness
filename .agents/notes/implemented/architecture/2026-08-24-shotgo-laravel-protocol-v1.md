# Agent Note: Freeze the ShotGo Laravel Agent Protocol v1

Status: implemented

English | [中文](2026-08-24-shotgo-laravel-protocol-v1.zh.md)

## Problem

The Agent Runtime needs a stable Laravel boundary before replacing Phase 0A mocks. Without a frozen contract, inference routing, AIGC generation, billing confirmation, idempotent recovery, collaborative canvas revisions, and long-running event replay could develop incompatible meanings on each side.

## Decision

Freeze wire version `2026-08-25.1` in `apps/shotgo-agent/contracts/`. Laravel is the sole business authority. Harness reasoning calls only Laravel-approved Ark routes with service-only runtime configuration; text/image/video/audio business generation uses capability endpoints and is never confused with inference.

Every business mutation carries the four-part correlation context and an `Idempotency-Key` equal to `clientRequestId`. Unknown outcomes are recovered by that key. Quotes are versioned and require confirmation; money is a decimal string. Canvas operations use expected revision and fail closed on conflict. Project event sequences, opaque event IDs, operation IDs, Harness session sequence, and Gateway cursors remain separate identifiers.

The browser-to-runtime handoff used a single-use ticket exchanged under service authentication for an opaque short-lived capability grant. The [Canvas-hosted Agent Grant decision](2026-08-25-shotgo-canvas-hosted-agent-grants.md) supersedes that transport while retaining Laravel as the sole authorization authority.

## Consequences

Laravel and Agent Runtime can now be implemented independently against the same OpenAPI, JSON Schema, TypeScript invariants, and contract suite. Real generation, billing, and canvas writes remain disabled until both implementations pass contract and integration acceptance. Any incompatible protocol change requires compatibility analysis and a new version rather than silent mutation of v1.

## Alternatives considered

- Direct supplier access from Harness: duplicates Laravel routing, key, permission, billing, and refund authority.
- One endpoint for inference and AIGC generation: hides materially different lifecycle, billing, and streaming semantics.
- Blind mutation retries: can double-charge or duplicate jobs and canvas operations.
- Last-write-wins canvas updates: can silently overwrite collaborative edits.
