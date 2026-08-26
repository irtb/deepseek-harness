# Agent Note: Confirmed additive Canvas plans

Status: implemented

English | [中文](2026-08-26-confirmed-additive-canvas-plans.zh.md)

## Problem

The read-only Canvas plan preview could explain a workflow but could not safely materialize it. Letting a model call the existing generic Canvas operation API would expose updates and deletion, while using model-authored counts or credit text in approval would make confirmation misleading.

## Decision

The Canvas Preset first reads the current compact snapshot, previews a closed plan, and asks Laravel for a five-minute encrypted plan quote bound to the Grant authorization context, Session, user, nullable team, space, project, Canvas revision, stable node keys, and stable connection keys. The quote contains one virtual Agent credit and never calls the Laravel billing path.

`canvas_ops_apply` consumes the quoted plan through the trusted one-shot approval channel. Laravel locks the project, verifies the unchanged revision and current authorization, rejects occupied keys and node locks, and passes only new `node.upsert` and `edge.upsert` operations to the existing Canvas operation service. Existing nodes and connections cannot be updated or deleted. A complete matching retry replays without another write or event; partial or mismatched state fails closed.

## Language policy

Canvas, Image, and Video Agent conversational reasoning and replies default to Simplified Chinese and change language only after an explicit user request. This default never constrains the language of creative output, including artwork text, prompts, scripts, subtitles, and narration.

## Alternatives considered

**Expose the generic Canvas operation API to the model.** Rejected because the existing operation types include mutations outside this phase and would enlarge the effect of a mistaken tool call.

**Charge the existing Laravel credit ledger for Canvas planning.** Rejected because this phase uses a temporary fixed Agent value and must not change the established generation deduction policy.

**Treat default reply language as an output-language default.** Rejected because conversational presentation and the requested creative content are independent user intents.

## Consequences

Users can approve one exact additive plan and see the authoritative result in the conversation. Any Canvas change after quoting requires a fresh read, quote, and confirmation. Media nodes are placeholders rather than generation results, and updates, movement, overwrite, deletion, and real Canvas-operation billing remain unavailable.
