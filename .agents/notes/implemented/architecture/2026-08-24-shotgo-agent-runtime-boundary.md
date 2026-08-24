# Agent Note: ShotGo agent runtime boundary

Status: implemented

English | [中文](2026-08-24-shotgo-agent-runtime-boundary.zh.md)

## Problem

ShotGo needs Canvas, Image, and Video conversational agents while continuing to update from DeepSeek Harness. Putting product behavior in upstream packages would make upgrades conflict-prone, while letting Harness call model suppliers or the ShotGo database would create a second authority for routing, credentials, permissions, billing, generation jobs, and canvas state. The first implementation also needs a deterministic path that proves the Harness loop and a ShotGo tool can work before Laravel wire contracts exist.

## Decision

ShotGo product code lives only in the private `@shotgo/agent-runtime` workspace App under `apps/shotgo-agent`. It composes public Harness services and Cordis extension points without modifying `packages/`, `vendor/`, `native/`, `apps/web/`, or `agent-loop`.

The runtime distinguishes Host Plane services from Agent Plane Presets. The Host Plane owns process boot, Session persistence, the LLM provider seam, and shared ShotGo tools. Three trusted versioned Presets own session-specific Persona, prompt, Skill, Tool visibility, and policy. They share implementations; their directories are composition declarations, not three services or code copies.

Harness owns the inference loop and Session log. Laravel remains the authority for both inference-provider routing and business AIGC operations. The future `ShotGoLlmAdapter` calls Laravel inference; image, video, text, audio, canvas, quote, billing, job, and asset Tools call Laravel capability APIs. Harness never holds supplier credentials or accesses the ShotGo database.

Phase 0A ships a keyless, read-only assembly. A deterministic mock `LlmAdapter` calls only `generation_config_read`, and a Loader-booted snapshot proves message, request header, tool call, tool result, second inference step, final answer, and durable Session flush. No Laravel endpoint, billing rule, generation submission, or canvas mutation is invented before Phase 0B freezes those protocols.

## Alternatives considered

- **Modify Harness core packages with ShotGo behavior** — rejected because every upstream merge would mix product changes with framework changes and the same business authority would be implemented twice.
- **Create three independent Agent services or repositories** — rejected because Gateway, inference routing, Laravel client, Session persistence, policies, and most tools are shared; copies would drift.
- **Connect Harness directly to inference or AIGC suppliers** — rejected because Laravel already owns credentials, model visibility, cost, credits, provider routing, durable jobs, refunds, and assets.
- **Start with a provisional real Laravel API** — rejected because an unreviewed temporary wire format would become accidental compatibility debt. The keyless vertical slice proves Harness composition first.

## Consequences

- Upstream upgrades can treat `apps/shotgo-agent` and the workspace lockfile as the expected product delta; an unavoidable core patch must be exceptional and recorded in `PATCHES.md`.
- The Phase 0A executable is a smoke entry rather than the production Gateway, but its Session transcript pins the first model-visible contract.
- Phase 0B must define inference streaming, cancellation, error and retry semantics, Capability Grants, idempotency identifiers, reasoning-model configuration, and billing before external writes are enabled.
- Production Presets cannot load user roots, shell, filesystem, terminal, subagent, self-modification, or dynamic plugin installation capabilities.
