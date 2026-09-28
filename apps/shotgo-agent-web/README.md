# ShotGo Agent Web

English | [中文](README.zh.md)

Private ShotGo product frontend. It is separate from upstream Harness `apps/web` and is built into the Agent release package as `web/`.

The login page and workspace offer a light/dark theme switch, default to light, and remember the choice in this origin's browser storage. Workflow details and conversation messages share one vertically scrollable area with an always-visible, keyboard-operable scrollbar; the composer stays at the bottom.

The frontend signs in directly on the Agent origin and keeps its own Bearer token and user snapshot; it never reads Canvas LocalStorage. It restores the identity through Laravel `/api/me`, clears expired identity locally, switches the existing personal/team account context through Laravel, and loads only the spaces visible in that context. Conversation history is isolated by user, active team, media mode, and opaque Session ID.

The Gateway Session hook issues and silently renews short-lived Capability Grants, submits idempotent Runs, persists the replay cursor after every event, and advances past prior Run terminal events before reconnecting to the current Run. It restores assistant text from versioned Session events, supports cancellation, and retains up to fifty local history entries per scope. The exceptional-decision projection accepts only replayable Gateway `session.event` records whose `eventType` is `exception.decision`, persists decision IDs and Gateway cursors per Session, and recovers authoritative status from Laravel after reload. The browser sends its own user Bearer token to Laravel approval endpoints. The Capability Grant is used only for authenticated Gateway streaming and is never put in a URL.

New sessions default to automatic mode and auto-bind the preferred Space (`默认项目` when present, otherwise the first visible Space). When the Space list is empty, the client creates `默认项目` via `POST /api/spaces` and binds it. Users can switch back to manual mode or explicitly choose unbound Space. Automatic mode has no ordinary confirmation card; Manual Run Start confirmation happens at most once per Skill Run. Exceptional decisions still cover hard budget or permission expansion and destructive, cross-project, public-sharing, or publishing actions.

The image and video composer loads Laravel's generation configuration with safe local defaults, sends a structured `generationContext` with every Run, and limits image references to nine media-library IDs. Assistant output uses HTML-disabled Markdown with safe-link filtering. Replayable Gateway artifact events render authoritative queued, processing, succeeded, or failed image/video cards without invented progress percentages.

Image references now use a visual, paginated Laravel media-library picker instead of manual ID entry. Personal, group, and team scopes remain server-authorized; the frontend submits only selected image IDs, preserves selections across pages, restores known selected assets, and enforces the nine-image limit. This picker deliberately excludes upload, deletion, sharing, and other mutating library actions.

After login, the sidebar and creative timeline treat Laravel account-level creative sessions as authority: the client loads the session list and detail (user prompts plus generation task cards). Browser localStorage is only a disposable cache. Assistant prose and tool traces are not uploaded; a refresh keeps user copy and finished media cards. If sync fails, the UI says creative history could not sync and still shows the cached or local draft.

## Synthetic UAT workflow

The workflow parser retains v1/v2 and accepts metadata-only v3 with constraint/change digests, Brief/Plan references, recorded times, five Gate versions, repair references and synthetic Delivery. Independently observed synthetic receipts provide cumulative charges and a referenced budget snapshot; quotes never establish settlement. Missing cost authority remains unknown, and incomplete Gate/Delivery evidence never establishes deliverability. Normal Gateway activation is not enabled by the offline fixture. Persisted active-Run recovery reconnects without posting another message; a freshly authenticated scoped stream may rebind its process epoch while retaining the session cursor. Responded manual approval IDs remain consumed on replay, and unresolved failed Runs stay locked with an explicit reconnect action. Remote-only history without an active pointer does not imply restored execution.

## Local checks

```sh
pnpm --filter @shotgo/agent-web typecheck
pnpm --filter @shotgo/agent-web test
pnpm --filter @shotgo/agent-web build
```

The application routes `/ai-tool/image-generator` and `/ai-tool/video-generator` both fall back to the SPA entry. The separately approved Canvas compatibility routes now redirect these two legacy standalone pages to the Agent origin without forwarding browser state; embedded Canvas Agent functionality remains in Canvas. Production Laravel CORS and route cutover still require human deployment. This package does not read Canvas LocalStorage.
