# Agent Note: ShotGo generation confirmation

Status: implemented

English | [中文](2026-08-25-shotgo-generation-confirmation.zh.md)

## Problem

A model-authored sentence such as "the user confirmed" is not proof that the authenticated Canvas user approved a quoted generation charge. The decision must remain attached to the exact live tool call and authorization context.

## Decision

Harness `ApprovalService` is mounted in the ShotGo runtime. A pre-execution gate marks only `generation_submit` as approval-required. Its pending request is audited in the Session log and projected as `approval.requested`; Canvas answers through `POST /api/agent/v1/sessions/{sessionId}/approvals/{approvalId}` with the current Capability Grant.

The Gateway re-introspects `agent.session.approval.respond`, verifies the live authorization context and Session, and accepts only `allowed-once` or `rejected`. An identical retry is idempotent; a changed, stale, cross-Session, unavailable, or cancelled decision fails closed. Approval is consumed by the same in-flight tool execution and is never returned to the model as reusable authority.

## Consequences

The browser must render pending approval events and post the user's decision. Generation submission remains absent until the next phase provides the Laravel idempotent mutation; therefore this phase cannot charge credits or create jobs by itself.
