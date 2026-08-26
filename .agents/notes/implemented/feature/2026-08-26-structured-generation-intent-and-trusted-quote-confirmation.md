# Agent Note: Structured generation intent and trusted quote confirmation

Status: implemented

English | [中文](2026-08-26-structured-generation-intent-and-trusted-quote-confirmation.zh.md)

## Problem

The ShotGo image and video composers displayed generation settings, but the Gateway accepted only free text. The model could therefore change a visible selection before quoting. The submission confirmation also rendered `kind`, `modelId`, and `credits` copied from model-supplied `generation_submit` arguments even though Laravel charged the opaque quote. A model could display a smaller amount than the quote Laravel would execute.

## Decision

Gateway protocol `2026-08-26.1` accepts an optional, strictly validated `generationContext` containing the image or video kind, model ID, and scalar parameter selections. The context kind must match the Grant-bound Agent mode. The Gateway serializes the original user request and structured context as deterministic JSON in the model-visible user message, binds the context to the active Run, and overlays only the selected scalar values when `generation_quote` calls Laravel. The prompt produced by the Agent remains the quote prompt. The binding is cleared when that Run settles.

The structured context is authenticated user intent, not authorization or pricing authority. Laravel continues to validate the model and parameters and owns quotes, credits, refunds, and generation idempotency. Raw URLs, paths, file bytes, and attachments are rejected by the Gateway schema.

Each validated Laravel quote is recorded in a process-local registry bounded to 16 pending quotes per Session and 512 globally. The confirmation gate atomically consumes one unexpired entry and renders its Laravel model, normalized parameters, and credits. `generation_submit` accepts only `quoteId` and `quoteVersion`; model-supplied display fields no longer exist. A reused, missing, expired, or version-mismatched quote fails closed and requires a fresh quote.

## Alternatives considered

**Encode selections only in natural-language prompt text.** Rejected because the model could reinterpret or omit them, and delimiters inside user text could make the projection ambiguous.

**Let the browser submit or approve a Canvas quote directly.** Rejected because the Canvas quote is not the Grant-bound opaque Agent quote consumed by `generation_submit`; mixing them could display one price and execute another.

**Keep model-supplied confirmation fields and rely on Laravel at submit time.** Rejected because Laravel protected charging correctness but not the user's informed confirmation.

**Accept attachment URLs in the same protocol revision.** Rejected because attachment ownership, media type, role, and lifecycle require Laravel resolution from scoped media IDs. Scalar settings ship independently while that contract remains absent.

## Testing

Gateway tests cover a valid structured context and reject unknown media URL fields. Runtime tests cover trusted quote confirmation, spoofed model display fields, missing quotes, rejection, cancellation, and the existing generation lifecycle. Type checking and the assembled runtime test suite cover the new service registration and protocol types.

## Consequences

Visible scalar settings now reach Laravel quoting without model drift, and the approval amount always comes from the same quote Laravel will execute. Rolling deployment is Agent first and Canvas second: the new Canvas declares `2026-08-26.1`, while the new Agent projects legacy `2026-08-25.1` responses for undeclared old clients. A Gateway restart discards pending quote registry entries, so an interrupted confirmation requires a fresh quote; this fail-closed behavior is intentional. Attachments remain disabled until a separate scoped media-reference contract is implemented.
