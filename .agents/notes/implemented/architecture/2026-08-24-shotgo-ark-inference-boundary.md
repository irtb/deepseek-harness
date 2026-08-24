# Agent Note: ShotGo Ark inference boundary

Status: implemented

English | [中文](2026-08-24-shotgo-ark-inference-boundary.zh.md)

## Problem

Routing every Harness reasoning turn through Laravel would keep credentials and policy in one service, but it would also make PHP-FPM carry long-lived model streams, duplicate the Harness provider protocol, add one failure hop before every token, and couple Agent availability to Laravel streaming capacity. Business AIGC generation still needs Laravel transactions, queues, quotes, credits, assets, and refunds, so moving every model call into the Agent Runtime would remove required authority checks.

## Decision

ShotGo uses a mixed data-plane and control-plane design. `ShotGoArkLlmAdapter` registers the `volcengine-ark` Harness provider and reuses the public `DeepSeekAdapter` transport to call `https://ark.cn-beijing.volces.com/api/v3` with the Agent Host Plane's `ARK_API_KEY`. Product policy allows only `deepseek-v4-flash` and `deepseek-v4-pro`. Laravel supplies an expiring inference policy and accepts idempotent metadata-only usage reports; it never receives the provider key, prompts, messages, completions, or raw provider responses. All business text, image, video, and audio generation continues through Laravel capability APIs.

The wire version is `2026-08-24.1`. It removes `/api/internal/agent/v1/inference/stream`, adds `/api/agent/v1/inference-policy`, and adds `/api/internal/agent/v1/inference-usage`. A missing, expired, mismatched, or widening policy fails closed. Usage report identity is `llmRequestId`, which is also its `Idempotency-Key`.

The `ve-shotgo` deployment follows the existing ShotGo service conventions: `/data/projects/agent.shotgo.cn`, Supervisor, `www-data`, `/data/nginx/conf.d`, and `/data/nginx/logs.d`. Builds and dependency resolution happen before server cutover; a checksummed artifact is transferred over SSH so a Beijing release does not depend on GFW-sensitive package registries.

## Alternatives considered

**Laravel inference proxy.** This centralizes the key and request stream, but consumes PHP-FPM capacity, duplicates SSE and tool-call translation, and introduces an avoidable latency and failure hop. Laravel remains the control plane instead.

**Direct access to every AIGC supplier.** This would give one runtime consistent transport ownership, but it bypasses ShotGo quote, credit, queue, asset, refund, and provider-routing rules. Only the separate Agent reasoning credential moves to the Host Plane.

**Copy the upstream DeepSeek adapter into the product app.** This would permit unrestricted changes, but it creates a fork inside the fork and makes upstream fixes difficult to adopt. The product subclasses the public adapter and adds only provider identity and model policy.

**Install and build from GitHub on the server.** This resembles a conventional working-tree deployment, but makes releases depend on overseas network availability and mutable resolution. ShotGo retains the same server directories and process manager while transferring a prebuilt, checksummed artifact.

## Consequences

Reasoning streams no longer consume Laravel workers, and the product keeps upstream streaming, reasoning, tool-call, usage, retry, and cancellation semantics. The Agent service now owns Ark credential rotation, outbound provider reachability, rate-limit telemetry, and metadata usage delivery. Laravel and Runtime must jointly enforce the same policy version and budget before readiness opens. A real-key Ark acceptance test and Laravel integration test remain deployment gates; keyless boot and snapshots continue to work without `ARK_API_KEY`.
