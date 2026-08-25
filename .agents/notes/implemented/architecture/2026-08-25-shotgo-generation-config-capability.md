# Agent Note: ShotGo generation config capability

Status: implemented

English | [中文](2026-08-25-shotgo-generation-config-capability.zh.md)

## Problem

The Phase 0A `generation_config_read` tool returned a deterministic fixture. Phase 1 needs the same model-facing tool to report the image or video models Laravel currently permits for the authenticated ShotGo subject, without introducing billing or generation side effects.

## Decision

Laravel exposes `POST /api/internal/agent/v1/generation/config` under Agent service authentication. Each request also carries the opaque browser-issued Grant, Session id, and requested generation kind. Laravel resolves the Grant, revalidates its current user, team, and optional project scope, checks `generation.config.read`, enforces the Agent-mode kind boundary, and returns a no-store catalog.

The Gateway binds the current opaque Grant to the live Harness Agent scope only in memory. A refreshed Grant replaces that binding only after ordinary Session submission introspection returns the same authorization context. The scoped `generation_config_read` tool calls Laravel through a narrow reader service and forwards cancellation. Neither the Grant nor the service token enters a Harness Session event, tool result, runtime configuration file, or business database record.

The keyless entry retains its deterministic fixture as a local smoke fallback. Production `gateway-bin` always installs the Laravel reader. The response projected to the model contains the requested kind, visible model metadata, safe option constraints, and defaults under `parameterSchemaVersion: 1`; it excludes authorization context, Session identity, credentials, provider fields, upstream keys, and pricing rules. Catalog credit metadata describes option differences but never replaces a Laravel quote or user confirmation. Laravel remains the availability and parameter authority.

## Alternatives considered

**Reuse the browser Sanctum endpoint from Harness.** Rejected because it would require forwarding an account-wide browser credential to the independent Agent Runtime and would bypass the Session-scoped Grant boundary.

**Return the catalog during Grant introspection.** Rejected because admission and business configuration have different cache, call-frequency, and evolution needs. Keeping them separate lets tools refresh Laravel-owned model state without redefining Session identity.

**Persist the Grant with the Harness Session.** Rejected because the Grant is bearer authority. Session replay requires durable business identifiers and Tool results, not reusable credentials.

## Consequences

Phase 1 remains read-only: it does not quote, reserve or deduct credits, enqueue generation, store media, or mutate a canvas. Quote and generation submission require separate contracts, confirmation, idempotency, persistence-before-side-effect, and unknown-outcome recovery work.

The Laravel endpoint adds the parameter catalog to its existing response without changing `2026-08-25.1`; the private deployment publishes Laravel before the Agent that requires `parameterSchemaVersion: 1`, and rollback removes the Agent requirement before reverting Laravel. Both implementations fail closed on protocol, parameter schema, Session, kind, cache policy, unknown fields, invalid defaults, or malformed constraints.
