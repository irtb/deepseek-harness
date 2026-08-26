# ShotGo Agent Runtime

English | [中文](README.zh.md)

Private DeepSeek Harness assembly for ShotGo's Canvas, Image, and Video conversational agents.

Phase 0A is keyless and read-only. It boots a mock inference adapter, calls `generation_config_read`, records the complete Harness Session turn, and returns a deterministic answer. It does not connect to Laravel, call an AIGC supplier, charge credits, submit generation, or mutate a canvas.

Phase 0B freezes the Laravel boundary in [`contracts/`](contracts/README.md). Phase 0B.2 loads the encrypted-at-rest Ark credential and provider endpoint mapping from Laravel into process memory. The Canvas-hosted browser obtains a scoped Grant through its existing Sanctum identity; the browser-facing [Gateway protocol](contracts/gateway/README.md) uses Laravel introspection for idempotent Session submission, cancellation, and replayable SSE.

Phase 1 connects `generation_config_read` to Laravel's service-authenticated, Grant-bound read API. The tool returns the visible image or video models, safe parameter options and constraints, and defaults so the Agent can identify missing choices. Catalog credit metadata is descriptive and never replaces a Laravel quote or user confirmation. The opaque Grant remains only in the live Session binding and is never persisted; this phase still performs no quote, credit, generation, or canvas mutation.

Phase 2 adds the read-only `generation_quote` tool. The Gateway injects the current Grant and Session binding, Laravel revalidates the authorization context, and the tool returns a short-lived opaque quote with normalized parameters, exact credit breakdown, balance, and expiry. A quote neither charges credits nor submits work; the Agent must show it and request explicit user confirmation.

Phase 3 adds the trusted confirmation channel used immediately before `generation_submit`. Harness emits audited `approval.requested` and `approval.resolved` Gateway events, and Canvas answers the pending approval through a Grant-bound, Session-bound endpoint. Only `allowed-once` permits that exact tool call; rejection, cancellation, unavailable UI, stale decisions, and model-authored confirmation text all fail closed.

Phase 4 connects the approved `generation_submit` tool to Laravel. The Gateway derives a stable idempotency key from the Session and opaque quote, sends only trusted mutation context plus the quote, and never accepts user, team, price, or supplier fields from the model. Laravel revalidates the Grant, quote, current model configuration, balance, and frozen account context, reserves the existing request uniqueness key before charging, commits one job, and safely replays an identical retry without a second charge or provider call.

Phase 5 adds authoritative `generation_status` and approval-gated `generation_cancel`. Both remain bound to the creating user, nullable team, authorization context, and Session. Cancellation resolves its race with completion under a row lock: queued work is refunded before the worker can claim it, processing work is stopped locally without an unsafe refund because the supplier may already have charged, and an already terminal task returns its existing final state.

Phase 6 adds stable asset results to completed generation status. Laravel returns only mirrored `user_media_assets` rows whose user, nullable team, source, and stored path match the generation. The Agent receives an opaque asset ID, media kind, public HTTP(S) URL, and byte size; provider responses, provider URLs, and private storage paths remain hidden. Media mirroring records the generation's frozen team context even if the user switches account context while the worker runs.

Phase 4A uses Gateway protocol `2026-08-26.2` for structured generation intent. Image contexts may include up to nine unique ordered `parameters.referenceAssets`, each containing only a positive `mediaLibraryItemId`; video references, raw URLs, paths, names, bytes, and additional fields are rejected. The Gateway records the UI selection in the Harness Session and replaces model-supplied quote options with it while preserving the Agent's final prompt. Laravel resolves media ownership and execution paths and remains authoritative for validation, pricing, charging, refunds, and idempotency; the model-facing quote tool exposes no reference field. Rolling deployment is Agent, API, then Canvas: explicit Gateway `2026-08-26.1` scalar clients and undeclared `2026-08-25.1` legacy clients remain supported, while Laravel requests declare `2026-08-26.1` and accept `2026-08-25.1` responses during the bounded transition.

Phase 4B cold-resumes a persisted Session only after a fresh Laravel Grant exactly matches the model-invisible Gateway recovery binding for user, team, space, project, mode, preset, and runtime version. The binding is stored atomically beside the Harness log and never contains a Grant or credential. Every live materialization has a new `streamEpoch`, so Canvas resets a stale process-local cursor after restart. Interrupted inference and approvals are closed rather than resumed; the next user message starts a new Run.

Phase 4C reads a Grant-bound compact Canvas snapshot and presents a read-only proposed workflow. `canvas_plan_preview` accepts one to twelve uniquely identified nodes, no more than twenty-four unique non-self dependencies, bounded non-blank text, and a non-negative integral credit estimate. The estimate is descriptive only: the plan neither writes Canvas state nor replaces Laravel's quote and confirmation flow.

Phase 4E turns an unchanged read-only plan into a short-lived Laravel-authoritative quote and exposes `canvas_ops_apply` only in the Canvas Preset. The trusted UI confirms the exact quoted node and dependency counts immediately before Laravel adds stable-keyed nodes and connections. Revision drift, scope changes, locks, occupied keys, malformed quotes, and partial replays fail closed. This phase never updates or deletes existing Canvas state and reports one virtual Agent credit without calling the Laravel billing path.

Canvas, Image, and Video Agent conversational reasoning and replies default to Simplified Chinese and switch language only when the user explicitly requests it. This default does not constrain creative output: artwork text, prompts, scripts, subtitles, narration, and other generated content follow the user's requested language.

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
- Laravel runtime configuration, inference policy, metadata usage, Grant introspection, generation configuration, read-only quote, trusted confirmation, idempotent generation submission, status, recovery lookup, cancellation, and additive Canvas plan clients are implemented. Canvas mutation is limited to confirmed stable-key node and connection creation.
- Existing Canvas node or connection updates and deletion remain unavailable to the Agent.
- Gateway SSE replay remains process-local and bounded to 512 events. Cold recovery restores completed Harness history for the next Run, but does not provide cross-device Session discovery, multi-instance coordination, or unfinished-Run replay.
