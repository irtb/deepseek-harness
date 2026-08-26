# Agent Note: Bound Canvas plan previews at every parser

Status: implemented

English | [中文](2026-08-26-bounded-canvas-plan-preview.zh.md)

## Problem

The Canvas plan tool checked only aggregate counts, node identity closure, and estimated credits. It admitted blank or oversized text, self-references, and repeated dependencies. The browser then applied different rules to live Gateway output and local storage, so an invalid plan could render live even though a refresh later rejected it.

## Decision

`canvas_plan_preview` rejects empty plans, blank or oversized summary, model, node identifiers and names, duplicate node identifiers, self-references, duplicate dependencies, dependencies outside the declared node set, non-integral credit estimates, and aggregate count overflow.

Canvas uses one `isAgentCanvasPlan` validator for both tracked Gateway tool results and persisted chat history. Only a valid, read-only, confirmation-required plan can become or recover a plan card.

## Testing

The assembled Tool Runtime exercises valid output and every rejected class without an inference key. Canvas event and storage suites cover closed dependencies, blank text, duplicate nodes, self-references, duplicate dependencies, and untracked tool results.

## Alternatives considered

**Rely on the browser to sanitize model output.** Rejected because malformed data would still enter the Harness Session and different clients could interpret it differently.

**Keep separate live and storage validators.** Rejected because identical durable data would continue to have two acceptance rules that can drift.

## Consequences

Plan cards have one bounded representation across the Agent Runtime, live Canvas events, and browser recovery. The limits deliberately exclude unusually large planning graphs; users must split those workflows into smaller plans. The plan remains descriptive and does not authorize billing or Canvas mutation.
