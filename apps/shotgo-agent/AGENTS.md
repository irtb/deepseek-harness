# AGENTS.md — ShotGo Agent Runtime

These rules apply to every file under `apps/shotgo-agent/`. They supplement the repository-root `AGENTS.md`; when they differ, the stricter safety, testing, and upstream-isolation rule wins.

## Product scope

This app is ShotGo's private conversational AIGC runtime. It assembles three session-scoped agents in one process:

- `canvas`: plan and project operations onto a ShotGo canvas.
- `image`: collect image parameters, quote, confirm, submit, and explain results.
- `video`: collect video parameters, quote, confirm, submit, recover, cancel, and explain results.

The three modes share the Gateway, LLM adapter, Laravel capability client, session persistence, policies, and tool implementations. Keep only mode-specific prompts, plans, schemas, and policies under `src/agents/{canvas,image,video}`. Do not copy shared implementations into three agent directories.

## Upstream isolation

- Follow `DEVELOPMENT.md`: every independently reviewable item uses a new branch created from `master` or the designated `release/*` branch. Never develop directly on either protected branch.
- Merge only after every applicable required check passes. A skipped, unavailable, flaky, or failing gate blocks the merge.
- Never place product behavior in upstream-owned `packages/`, `vendor/`, `native/`, or `apps/web/`.
- Consume Harness only through published workspace package exports and documented Cordis extension points. Never import another workspace's `src/` by relative path.
- Do not modify `agent-loop` for ShotGo behavior. Implement behavior as a plugin, provider, consumer, policy, prompt section, or preset.
- Record the pinned upstream tag and full SHA in `UPSTREAM.lock`. Record every unavoidable upstream-core patch in `PATCHES.md` with its upstream Issue or PR.

## Runtime ownership

Keep the two Cordis planes explicit:

- Host Plane: process entry, Gateway, authentication, `ShotGoLlmAdapter`, Laravel client, Session Store, telemetry, and process-level registries.
- Agent Plane: session-scoped Persona, prompt sections, Skills, Tools, and policies mounted by a trusted versioned Preset.

Production Presets must set `includeUserRoot: false` and must not mount shell, filesystem, terminal, subagent, dynamic plugin installation, or self-modification capabilities.

Every contribution is a Cordis effect. Function plugins use named `name`, `inject`, `Config`, and `apply` exports with no default export. Register and dispose services, adapters, tools, prompt sections, and listeners through their owning context.

## Model boundaries

Distinguish these calls in names, types, logs, and tests:

- Agent inference: a tool-calling text/reasoning model used by the Harness loop. `ShotGoArkLlmAdapter` reaches only the Laravel-approved `deepseek-v4-flash` and `deepseek-v4-pro` models through Volcano Ark's OpenAI-compatible API.
- Business generation: text, image, video, and audio asset generation. Model-facing Tools reach it only through Laravel capability APIs.

Laravel encrypts the Ark credential at rest and returns it with the logical-to-provider model mapping only through the service-authenticated runtime-configuration endpoint. The Agent Runtime keeps that response in process memory, calls Ark directly, and never persists or logs the credential. Laravel remains authoritative for model allowlists and defaults, per-session budget policy, usage audit, users, permissions, quotes, credits, generation queues, assets, and refunds. Missing or invalid runtime configuration or policy must fail closed; it must never silently widen a grant or switch to an unapproved model.

`ShotGoArkLlmAdapter` extends Harness `LlmAdapter` through the public DeepSeek adapter package. It must preserve tool-call streaming, usage, finish reasons, provider request identity, retry classification, and `AbortSignal` cancellation. Never log credentials, prompts, completions, or raw provider responses in control-plane usage reports.

## Laravel capability rules

- Treat Laravel as the authority for users, teams, projects, permissions, budgets, canvas state, generation state, media, and billing.
- Never access the ShotGo database directly.
- Every mutating call carries `sessionId`, `runId`, `actionId`, and `clientRequestId` and is idempotent at Laravel.
- A short-lived Capability Grant limits user, team, project, agent mode, allowed capabilities, budget, expiry, and `jti`. The Gateway cannot widen it.
- Confirmation is required before cost, deletion, overwrite, or a changed quote. A model statement is not user confirmation.
- Laravel generation records remain authoritative across browser or Agent Runtime restarts. `ctx.jobs` is session-local control only.

## Events and recovery

- Anything model-visible must be reconstructable from the Harness Session log.
- Keep Harness `sessionSeq`, Gateway stream cursor, Laravel Reverb event identity, canvas revision, and business idempotency keys separate. Correlate them; do not merge them into one counter.
- Persist stable opaque identifiers. Do not parse task IDs or state from natural-language model output.
- On unknown mutating outcomes, query Laravel by `clientRequestId` before retrying.
- Show real stages and elapsed time for long generation jobs; never fabricate percentage progress.

## Development order

Phase 0A is intentionally keyless and read-only:

1. Boot one private `@shotgo/agent-runtime` workspace App.
2. Mount Host Plane plus three minimal trusted Presets.
3. Register a mock `LlmAdapter` and a read-only mock `generation_config_read` Tool.
4. Prove the complete message → tool call → tool result → answer loop with a keyless assembled snapshot.
5. Add no Laravel writes, billing, generation submission, or canvas mutation until Phase 0B freezes the wire protocols.

Phase 0B freezes `contracts/openapi.json`, `contracts/schemas/laravel-v1.schema.json`, and `src/contracts/laravel-v1.ts`. Laravel and Agent Runtime implementations may now proceed independently, but real writes and billing stay disabled until both sides pass contract and integration acceptance.

## Tests and documentation

- Add focused unit coverage for parsers, policies, and adapter chunk mapping.
- Add a Loader-booted real-composition test for every product-visible plugin or Preset behavior.
- Add or update a keyless snapshot for every model-visible or user-visible behavior.
- Test tool visibility denial, cancellation, partial streams, stable error codes, disposal, replay, and idempotent recovery where applicable.
- Run the app's focused typecheck, lint, unit, and snapshot commands before broader repository gates.
- Update the app README and relevant protocol documentation in the same change as behavior or configuration.
- Non-trivial changes include an Agent Note as required by the repository root rules.

## Current implementation boundary

The Phase 0B.2 wire protocol is frozen at `2026-08-24.2`. It keeps inference streaming in the Agent Runtime and adds service-authenticated runtime configuration beside inference policy and metadata-only usage reporting. Do not change an endpoint, field, lifecycle, authentication flow, error code contract, or event cursor semantics without a new development branch, synchronized contract artifacts, compatibility analysis, and passing contract tests. Business-generation integrations remain fixtures or mocks until a Laravel implementation is available and accepted.
