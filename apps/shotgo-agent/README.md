# ShotGo Agent Runtime

English | [中文](README.zh.md)

Private DeepSeek Harness assembly for ShotGo's Canvas, Image, and Video conversational agents.

Phase 0A is keyless and read-only. It boots a mock inference adapter, calls `generation_config_read`, records the complete Harness Session turn, and returns a deterministic answer. It does not connect to Laravel, call an AIGC supplier, charge credits, submit generation, or mutate a canvas.

Phase 0B freezes the Laravel boundary in [`contracts/`](contracts/README.md). Phase 0B.2 loads the encrypted-at-rest Ark credential and provider endpoint mapping from Laravel into process memory; real writes and billing remain disabled until both sides pass contract and integration acceptance.

## Local smoke

```sh
pnpm --filter @shotgo/agent-runtime run dev -- "我能使用哪些图片模型？"
```

## Focused checks

```sh
pnpm --filter @shotgo/agent-runtime run typecheck
pnpm --filter @shotgo/agent-runtime run test
pnpm --filter @shotgo/agent-runtime run test:contract
pnpm --filter @shotgo/agent-runtime run test:gateway
```

## Deployment baseline

The production baseline is documented in [`deploy/`](deploy/README.md). It builds a loopback-only Gateway with separate `/healthz` and `/readyz` endpoints. Readiness defaults to `503` until Laravel v1 integration acceptance explicitly enables traffic.

## Architecture

- `config/base.cordis.yml` assembles the Phase 0A Host Plane.
- `config/agent-presets/` contains the three trusted Agent Plane compositions.
- `src/llm/` owns the Harness LLM provider implementation.
- `src/tools/` owns shared model-facing ShotGo tools.
- `contracts/` contains the frozen OpenAPI and JSON Schema Laravel protocol.
- Laravel remains authoritative for identity, permissions, models, billing, canvas state, generation jobs, and assets.

## Model Experience

The Phase 0A mock always requests the read-only `generation_config_read` tool and then explains its result. No supplier model is called, so the transcript is keyless and deterministic. Replacing the mock after Phase 0B changes the inference provider but not the business-generation ownership boundary.

#### KV Cache effect

The three Presets have distinct persona text. Within one Preset, the prompt and tool schema remain stable across turns; dynamic Laravel capability results will appear only as tool results after Phase 0B.

## Known Limitations and Deferred Work

- The executable is a Phase 0A smoke entry, not the production Gateway.
- Preset discovery and per-session selection are declared but not yet wired into a public session endpoint.
- Laravel runtime configuration, inference policy, and metadata usage clients are implemented; handoff exchange and business capability clients remain disconnected.
- Billing, generation submission, and canvas mutation stay disabled until both implementations pass contract and integration acceptance.
- The deployment Gateway currently exposes health/readiness only; public Agent session routes are not implemented.
