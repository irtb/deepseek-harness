# ShotGo Agent Runtime

English | [中文](README.zh.md)

Private DeepSeek Harness assembly for ShotGo's Canvas, Image, and Video conversational agents.

Phase 0A is keyless and read-only. It boots a mock inference adapter, calls `generation_config_read`, records the complete Harness Session turn, and returns a deterministic answer. It does not connect to Laravel, call an AIGC supplier, charge credits, submit generation, or mutate a canvas.

Phase 0B freezes the Laravel boundary in [`contracts/`](contracts/README.md). Phase 0B.2 loads the encrypted-at-rest Ark credential and provider endpoint mapping from Laravel into process memory. The Canvas-hosted browser obtains a scoped Grant through its existing Sanctum identity; the browser-facing [Gateway protocol](contracts/gateway/README.md) uses Laravel introspection for idempotent Session submission, cancellation, and replayable SSE.

Phase 1 connects `generation_config_read` to Laravel's service-authenticated, Grant-bound read API. The tool returns the visible image or video models, safe parameter options and constraints, and defaults so the Agent can identify missing choices. Catalog credit metadata is descriptive and never replaces a Laravel quote or user confirmation. The opaque Grant remains only in the live Session binding and is never persisted; this phase still performs no quote, credit, generation, or canvas mutation.

Phase 2 adds the read-only `generation_quote` tool. The Gateway injects the current Grant and Session binding, Laravel revalidates the authorization context, and the tool returns a short-lived opaque quote with normalized parameters, exact credit breakdown, balance, and expiry. A quote neither charges credits nor submits work; the Agent must show it and request explicit user confirmation.

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
- `contracts/` contains the separately versioned Laravel control-plane and browser Gateway protocols.
- Laravel remains authoritative for identity, permissions, models, billing, canvas state, generation jobs, and assets.

## Model Experience

The Phase 0A mock always requests the read-only `generation_config_read` tool and then explains its result. No supplier model is called, so the transcript is keyless and deterministic. Replacing the mock after Phase 0B changes the inference provider but not the business-generation ownership boundary.

#### KV Cache effect

The three Presets have distinct persona text. Within one Preset, the prompt and tool schema remain stable across turns; dynamic Laravel capability results will appear only as tool results after Phase 0B.

## Known Limitations and Deferred Work

- The keyless executable remains a Phase 0A smoke entry; `gateway-bin` is the production process entry.
- `gateway-bin` mounts the restricted Harness Runtime, trusted mode Presets, Laravel Grant authorizer, Session submission, SSE replay, and cancellation. Production admission remains closed until Laravel implements and accepts Grant issuance and introspection.
- Laravel runtime configuration, inference policy, metadata usage, Grant introspection, generation configuration, and read-only quote clients are implemented; mutating business capability clients remain disconnected.
- Billing, generation submission, and canvas mutation stay disabled until both implementations pass contract and integration acceptance.
- Gateway replay is process-local and bounded to 512 events; restart recovery from the persisted Harness Session log is not yet connected.
