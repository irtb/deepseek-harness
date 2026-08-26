# Agent Note: ShotGo Gateway cold recovery

Status: implemented

English | [中文](2026-08-26-shotgo-gateway-cold-recovery.zh.md)

## Problem

Harness persisted the conversation log, but the ShotGo Gateway kept authorization bindings, live Agent handles, request cursors, and approvals only in process memory. A process restart therefore made a valid Session unreachable. Resuming solely from a browser-supplied Session ID would also let a refreshed Grant attempt to attach the wrong user, team, project, or Agent mode to persisted model history.

## Decision

The Gateway stores one model-invisible versioned recovery binding beside each Harness Session. The file contains the Session ID, stable Laravel `authorizationContextId`, user, nullable team, space, nullable project, Agent mode, trusted preset ID, runtime version, and creation time. It never contains a Capability Grant, Ark credential, supplier key, quote, or approval decision. The filename is a SHA-256 digest of the Session ID, the directory and file use restrictive modes, and publication uses an atomic rename.

Every cold access first authorizes the current Grant through Laravel, reads the binding, and requires exact equality across every stored scope field. It also requires the current runtime and mode-specific preset. A valid binding resumes the persisted log through the public `agents.resume()` extension point and mounts the trusted ShotGo preset. Missing, malformed, stale, or mismatched metadata fails closed; the Gateway never guesses ownership from the Session ID or Harness transcript.

Each live materialization receives a random `streamEpoch`. Message acceptance and every SSE event return that epoch. Canvas resets its process-local cursor when an accepted Run reports a different epoch and rejects events from another epoch. Harness persistence closes an interrupted turn during cold load; the Gateway does not continue a model call or restore a pending approval. A later user message starts a new Run. Laravel generation status and deterministic submission keys remain the authority for work already submitted before the restart.

The recovery binding remains app-owned under `apps/shotgo-agent`; no ShotGo behavior or metadata field is added to upstream Harness packages.

## Alternatives considered

**Add ShotGo authorization fields to `SessionHeader`.** Rejected because it would modify an upstream-owned durable format for product-private metadata and increase fork upgrade conflicts.

**Resume any existing Session using only its opaque ID.** Rejected because knowledge of an ID is not authority and cannot prove the current user, team, project, or mode owns the transcript.

**Persist the Capability Grant for restart recovery.** Rejected because Grants are short-lived bearer credentials. Laravel reissues and introspects a fresh Grant for every access.

**Continue an interrupted model call or pending approval.** Rejected because crash repair closes interrupted turns and an old approval cannot safely authorize execution after process state and quote caches are lost.

## Testing

Gateway tests create and settle a Session, dispose the first Gateway service, cold-resume it through a second service, verify both user turns remain in the Harness log, verify the stream epoch changes, and reject a Grant whose project differs while its `authorizationContextId` collides. Contract and Canvas tests require the epoch on accepted Runs and SSE events.

## Consequences

A single Gateway instance can restart without discarding completed conversation history, and the next authorized message continues the same Harness Session. Restarted streams cannot silently reuse an in-memory cursor from the prior process. Missing bindings on legacy Sessions fail closed and require a new Session instead of an unsafe migration. Cross-device session discovery, multi-instance coordination, resuming unfinished inference, and reusing pre-restart approvals remain outside this mechanism.
