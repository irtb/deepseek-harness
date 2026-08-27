# Agent Note: Laravel-managed Ark runtime configuration

Status: implemented

English | [中文](2026-08-24-shotgo-laravel-managed-ark-runtime-configuration.zh.md)

## Problem

Harness must call the Volcano Ark reasoning endpoint without making Laravel proxy a long-lived model stream, while ShotGo operations must configure the provider credential and endpoint IDs through one production control plane. Keeping a separate key and model mapping in the Agent environment would create two configuration authorities, make administrative rotation incomplete, and allow the deployed adapter to diverge from the Laravel model records that team policy references.

## Decision

Laravel is the storage authority for the Ark API key, provider base URL, and provider endpoint IDs behind the logical `deepseek-v4-flash` and `deepseek-v4-pro` names. The API key uses Laravel's encrypted model cast and the administrative API treats it as write-only: reads disclose only whether a key exists. Provider endpoint IDs and per-model inference policy remain ordinary model configuration. The release importer reads workstation deployment variables and writes generic configuration through standard input; Laravel application code and Harness do not recognize those deployment variable names.

The current Laravel wire protocol includes `GET /api/internal/agent/v1/inference-runtime-config`. Only the Agent service bearer token authenticates this endpoint. A successful response carries `Cache-Control: no-store`, the provider base URL, the decrypted key, both distinct provider endpoint IDs, and an opaque configuration version. Missing, disabled, duplicate, undecryptable, or incomplete database configuration returns a retryable `INFERENCE_RUNTIME_CONFIG_UNAVAILABLE` problem without partial secrets.

The Agent Runtime validates the response at the HTTP boundary, retains one immutable copy in process memory, and clears readiness after any refresh failure. `ShotGoArkLlmAdapter` continues to expose logical model names to Harness while sending the mapped provider endpoint ID on the Ark request. Neither the credential nor provider endpoint IDs enter a browser response, capability grant, Harness Session event, usage report, command argument, or application log.

Ark inference stays in the Agent process and reuses the public `DeepSeekAdapter` transport, so Laravel workers never carry the token stream. Laravel supplies the account policy; the Gateway applies its model, output limit, and reasoning effort to the session. The adapter reports metadata-only token counts, duration, status, purpose, and model after each session-scoped inference call through the idempotent usage endpoint. Reporting excludes prompts, messages, completions, credentials, and raw provider responses. Usage storage is audit-only while inference billing is disabled, so a reporting outage is recorded operationally but does not corrupt an otherwise completed model stream. Business text, image, video, and audio generation continues through Laravel capability APIs with its existing quote, credit, queue, asset, and refund authority.

The `ve-shotgo` release still uses `/data/projects/agent.shotgo.cn`, Supervisor, `www-data`, and a prebuilt checksummed artifact. The Agent environment contains only the Laravel base URL and Agent service token for this configuration path; it contains no Ark key or provider model IDs. Readiness requires both explicit traffic enablement and a currently valid in-memory runtime configuration.

## Alternatives considered

**Agent-owned Ark environment variables.** This keeps the runtime independent after startup, but duplicates the production configuration authority and bypasses the database-backed model administration flow. The Laravel service endpoint gives rotation one owner while the Agent still performs inference directly.

**Laravel inference proxy.** This keeps the key from the Agent process, but consumes PHP-FPM capacity for long model streams, duplicates SSE and tool-call translation, and adds a failure hop to every token. Laravel distributes configuration but does not proxy the stream.

**Return credentials in the capability policy.** This avoids a second endpoint, but exposes a service credential through a user-scoped path that the browser can call. Service configuration and user policy remain separately authenticated.

**Direct access to every AIGC supplier.** This gives the Agent one transport model, but bypasses ShotGo quote, credit, queue, asset, refund, and provider-routing rules. Only Agent reasoning calls Ark directly.

**Copy the upstream DeepSeek adapter into the product app.** This permits arbitrary model remapping, but creates a fork inside the fork. The ShotGo adapter subclasses the public implementation and delegates each mapped request through a captured configuration snapshot.

**Install and build from GitHub on the server.** This makes releases depend on overseas network availability and mutable dependency resolution. ShotGo transfers a prebuilt, checksummed artifact to the Beijing server instead.

## Consequences

ShotGo gains one operational owner for Ark credentials, endpoint mappings, inference policy, and usage audit while retaining direct low-latency inference and upstream streaming behavior. The shared administrative layout does not merge Agent inference into the business text-generation tables or Laravel execution path. Compromise of both the Laravel application key and its database can reveal the provider credential, and compromise of the Agent process can read its in-memory copy; service-token rotation, host isolation, no-store responses, write-only administrative fields, log redaction, and least-privilege process access remain required. Keyless boot and deterministic snapshots stay available, but real inference and readiness fail closed until Laravel configuration is complete. Contract tests pin service authentication, response validation, logical-to-provider mapping, session policy, metadata-only reporting, memory invalidation, and readiness behavior; a real-key Ark call remains a production acceptance step rather than a repository test.
