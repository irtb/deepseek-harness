# Agent Note: Scoped image media references

Status: implemented

English | [中文](2026-08-26-scoped-image-media-references.zh.md)

## Problem

Image Agent users need to select existing ShotGo media as generation references. Browser paths and URLs are not safe identifiers: they can escape the authenticated media scope, expose storage layout, drift after storage changes, and let a model substitute resources that the user did not select.

## Decision

Gateway protocol `2026-08-26.2` accepts image `generationContext.parameters.referenceAssets` as an ordered array of at most nine unique objects. Each object contains only one positive safe integer `mediaLibraryItemId`. Video contexts, duplicate IDs, raw URLs, paths, names, bytes, and additional fields fail with `GENERATION_CONTEXT_INVALID`. Explicit `2026-08-26.1` remains scalar-only, and an undeclared request receives the legacy `2026-08-25.1` projection.

The Gateway records the IDs in the model-visible deterministic generation context but does not expose a reference argument in the `generation_quote` tool schema. When the model calls that tool, the Gateway discards model-supplied generation options and injects the UI-selected `referenceAssets` into the Laravel quote request. Laravel validates ownership and media suitability, returns only the same ID objects in `normalizedParameters.referenceAssets`, and stores resolved trusted relative paths only inside its encrypted execution envelope. Agent Runtime never receives those paths.

Laravel request protocol `2026-08-26.1` carries this quote format. Agent clients send that version and temporarily accept response headers and bodies declaring either `2026-08-26.1` or `2026-08-25.1`. Deployment order is Agent, API, then Canvas. The previous Laravel response version remains accepted until Agent and API can be rolled back together without serving the older API; Gateway compatibility versions remain until their Canvas builds are no longer served or cached.

## Alternatives considered

**Send browser URLs or storage paths.** Rejected because neither value proves ownership, both leak storage concerns across the wire, and a URL can name content outside the current account scope.

**Expose media references to the model-facing quote schema.** Rejected because the model could reorder, omit, or substitute IDs after the user selected them. Gateway-owned injection preserves the authenticated UI intent.

**Resolve IDs in Agent Runtime.** Rejected because Laravel owns media records, account scope, storage paths, and the encrypted generation envelope. Giving Agent Runtime that lookup would duplicate authorization and expose execution paths.

**Add video references in the same revision.** Rejected because the approved Phase 4A.2a API resolves only the image reference contract. Video remains fail-closed until its input roles and provider mappings are frozen.

## Testing

Gateway tests accept ordered image media IDs only under `2026-08-26.2` and reject invalid numbers, duplicates, excess items, extra fields, previous-version references, and video references. Session tests prove UI references replace model parameters in the Laravel quote request. Contract and client tests pin the Gateway schema, Laravel quote schema, current request version, bounded previous-response compatibility, and rejection of malformed normalized references.

## Consequences

The browser can reference existing images without sending a path or URL, and the model cannot alter the selected media before quoting. Laravel performs the only ownership resolution and keeps execution paths out of Agent-visible data. The compatibility window adds one temporary response parser branch and requires coordinated removal after the rollback window closes. Video reference generation remains unavailable.
