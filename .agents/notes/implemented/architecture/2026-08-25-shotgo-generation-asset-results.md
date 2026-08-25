# Agent Note: ShotGo generation asset results

Status: implemented

English | [中文](2026-08-25-shotgo-generation-asset-results.zh.md)

## Problem

A completed image or video generation needs a usable result without exposing raw provider responses, temporary provider URLs, private storage paths, or an asset owned by another user or team. Async media storage must also retain the generation's authorization context when a user changes active account context while the worker is running.

## Decision

Laravel resolves asset results from the existing `user_media_assets` ledger. A result is returned only when the generation is complete, its kind is media, and a generation-source asset matches the generation's user, nullable frozen team, and normalized stored path. The response contains only the opaque asset identifier, media kind, public HTTP(S) URL, and byte size. Missing or mismatched ledger rows fail closed as an empty asset list.

Generation workers pass the generation log's frozen nullable team to media mirroring. Existing interactive uploads retain their current-context behavior. The Agent validates every asset field and URL protocol, then exposes the verified list through `generation_status`; no separate provider-facing asset lookup exists.

## Alternatives considered

Returning `result_text` directly was rejected because it can contain a provider URL or a private path. Returning `response_payload` was rejected because it is an internal diagnostic record. Adding a generation-to-asset foreign key was deferred because the current one-result workflow can safely join through the existing ownership ledger without a migration.

## Consequences

No schema migration is required. The current processor still publishes one primary media asset even when an image provider returns multiple images; multi-asset persistence requires a future explicit data-model and billing design. Deploy Laravel before the Agent contract consumer; roll back the Agent first.
