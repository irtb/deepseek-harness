# Agent Top Nav Menu Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Agent workspace top `mode-tabs` with canvas product nav: 无限画布、图片生成、视频生成、AI卡片生成 (same names, count, order); canvas destinations are cross-origin.

**Architecture:** Add `canvas-app-url.ts` to resolve `VITE_SHOTGO_CANVAS_ORIGIN` and build absolute canvas paths. Drive four header links from a small constant list in `AgentWorkspace.tsx`. Image/video stay same-origin; canvas items never get `active`.

**Tech Stack:** React 18, Vite, Vitest, Testing Library; env via `import.meta.env`.

## Global Constraints

- Scope: `agent.shotgo.cn/apps/shotgo-agent-web` only (no canvas/api/console edits).
- Menu order/copy fixed: 无限画布 → 图片生成 → 视频生成 → AI卡片生成.
- Cross-site: `{CANVAS_ORIGIN}/projects` and `{CANVAS_ORIGIN}/ai-tool/batch-image`.
- Same-site: `/ai-tool/image-generator`, `/ai-tool/video-generator`.
- Env: `VITE_SHOTGO_CANVAS_ORIGIN`; defaults `https://canvas.shotgo.cn`; development `http://localhost:5173`.
- Do not commit unless the user explicitly asks.
- Follow TDD: failing test before production code for each behavior unit.

---

## File Map

| File | Role |
|------|------|
| `apps/shotgo-agent-web/src/canvas-app-url.ts` | `canvasOrigin()`, `buildCanvasAppUrl(path)` |
| `apps/shotgo-agent-web/tests/canvas-app-url.spec.ts` | Unit tests for URL helper |
| `apps/shotgo-agent-web/src/AgentWorkspace.tsx` | Render four mode-tabs |
| `apps/shotgo-agent-web/tests/workspace-mode-tabs.spec.tsx` | Header menu order/href/active |
| `.env.example` / `.env.development` / `.env.production` | `VITE_SHOTGO_CANVAS_ORIGIN` |

---

### Task 1: Canvas URL helper

**Files:**
- Create: `apps/shotgo-agent-web/src/canvas-app-url.ts`
- Create: `apps/shotgo-agent-web/tests/canvas-app-url.spec.ts`

**Interfaces:**
- Produces: `canvasOrigin(): string`, `buildCanvasAppUrl(path: string, configuredOrigin?: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/shotgo-agent-web/tests/canvas-app-url.spec.ts
import { describe, expect, it } from 'vitest'
import { buildCanvasAppUrl, canvasOrigin } from '../src/canvas-app-url.ts'

describe('canvas-app-url', () => {
  it('defaults origin to production canvas', () => {
    expect(canvasOrigin()).toBe('https://canvas.shotgo.cn')
  })

  it('builds absolute canvas paths without trailing slash on origin', () => {
    expect(buildCanvasAppUrl('/projects', 'https://canvas.shotgo.cn/')).toBe(
      'https://canvas.shotgo.cn/projects',
    )
    expect(buildCanvasAppUrl('/ai-tool/batch-image', 'http://localhost:5173')).toBe(
      'http://localhost:5173/ai-tool/batch-image',
    )
  })

  it('rejects invalid origins', () => {
    expect(() => buildCanvasAppUrl('/projects', 'ftp://canvas.shotgo.cn')).toThrow('INVALID_CANVAS_APP_URL')
    expect(() => buildCanvasAppUrl('/projects', 'https://user:pass@canvas.shotgo.cn')).toThrow(
      'INVALID_CANVAS_APP_URL',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shotgo/agent-web test -- tests/canvas-app-url.spec.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/shotgo-agent-web/src/canvas-app-url.ts
export function canvasOrigin(): string {
  return String(import.meta.env.VITE_SHOTGO_CANVAS_ORIGIN ?? 'https://canvas.shotgo.cn').replace(/\/$/, '')
}

export function buildCanvasAppUrl(path: string, configuredOrigin?: string): string {
  const candidate = (configuredOrigin ?? canvasOrigin()).trim() || 'https://canvas.shotgo.cn'
  const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username
    || parsed.password
  ) {
    throw new Error('INVALID_CANVAS_APP_URL')
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${parsed.origin}${normalizedPath}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @shotgo/agent-web test -- tests/canvas-app-url.spec.ts`

Expected: PASS

- [ ] **Step 5: Wire env files**

Add `VITE_SHOTGO_CANVAS_ORIGIN=...` to:

- `.env.example` → `https://canvas.shotgo.cn` (comment that local may use `http://localhost:5173`)
- `.env.development` → `http://localhost:5173`
- `.env.production` → `https://canvas.shotgo.cn`

- [ ] **Step 6: Commit only if user asks** — skip by default

---

### Task 2: Four-item mode-tabs in AgentWorkspace

**Files:**
- Modify: `apps/shotgo-agent-web/src/AgentWorkspace.tsx` (header `.mode-tabs`)
- Create: `apps/shotgo-agent-web/tests/workspace-mode-tabs.spec.tsx`

**Interfaces:**
- Consumes: `buildCanvasAppUrl` from Task 1
- Produces: header links in fixed order with correct href/active

- [ ] **Step 1: Write the failing test**

```tsx
// apps/shotgo-agent-web/tests/workspace-mode-tabs.spec.tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { AgentWorkspace } from '../src/AgentWorkspace.tsx'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeToggle.tsx'

// Reuse the same auth/fetch stubs pattern as workspace.spec.tsx (copy minimal stubs so this file is standalone).

describe('AgentWorkspace mode-tabs', () => {
  beforeEach(() => {
    // stub auth + APIs like workspace.spec.tsx so AgentWorkspace mounts
  })

  it('renders four product nav items in canvas order on image mode', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <AgentWorkspace mode="image" />
        </AuthProvider>
      </ThemeProvider>,
    )
    const tabs = screen.getByRole('navigation', { name: '产品导航' })
    const links = within(tabs).getAllByRole('link')
    expect(links.map(a => a.textContent?.trim())).toEqual([
      '无限画布',
      '图片生成',
      '视频生成',
      'AI卡片生成',
    ])
    expect(links[0]).toHaveAttribute('href', 'https://canvas.shotgo.cn/projects')
    expect(links[1]).toHaveAttribute('href', '/ai-tool/image-generator')
    expect(links[1]).toHaveClass('active')
    expect(links[2]).toHaveAttribute('href', '/ai-tool/video-generator')
    expect(links[2]).not.toHaveClass('active')
    expect(links[3]).toHaveAttribute('href', 'https://canvas.shotgo.cn/ai-tool/batch-image')
  })

  it('marks video tab active on video mode', () => {
    render(
      <ThemeProvider>
        <AuthProvider>
          <AgentWorkspace mode="video" />
        </AuthProvider>
      </ThemeProvider>,
    )
    const tabs = screen.getByRole('navigation', { name: '产品导航' })
    const links = within(tabs).getAllByRole('link')
    expect(links[1]).not.toHaveClass('active')
    expect(links[2]).toHaveClass('active')
  })
})
```

Implementer must flesh stubs by copying from `tests/workspace.spec.tsx` (auth fetch, generation config, spaces) until `AgentWorkspace` mounts cleanly — do not invent new auth contracts.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shotgo/agent-web test -- tests/workspace-mode-tabs.spec.tsx`

Expected: FAIL (missing 无限画布 / AI卡片生成 / nav landmark)

- [ ] **Step 3: Update AgentWorkspace header**

Replace the current two-link `.mode-tabs` block with:

```tsx
<nav className="mode-tabs" aria-label="产品导航">
  <a href={buildCanvasAppUrl('/projects')}>无限画布</a>
  <a className={mode === 'image' ? 'active' : ''} href="/ai-tool/image-generator">
    图片生成
  </a>
  <a className={mode === 'video' ? 'active' : ''} href="/ai-tool/video-generator">
    视频生成
  </a>
  <a href={buildCanvasAppUrl('/ai-tool/batch-image')}>AI卡片生成</a>
</nav>
```

Import `buildCanvasAppUrl` from `./canvas-app-url.ts`. Keep surrounding header/account UI unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @shotgo/agent-web test -- tests/canvas-app-url.spec.ts tests/workspace-mode-tabs.spec.tsx
pnpm --filter @shotgo/agent-web test -- tests/workspace.spec.tsx
```

Expected: all PASS

- [ ] **Step 5: Commit only if user asks** — skip by default

---

## Spec Coverage Check

| Spec requirement | Task |
|------------------|------|
| Four items, names, order | Task 2 |
| Cross-site canvas URLs | Task 1 + 2 |
| Env `VITE_SHOTGO_CANVAS_ORIGIN` | Task 1 Step 5 |
| Active only for image/video | Task 2 |
| No canvas/api/console edits | Global Constraints |
| Tests | Task 1 + 2 |
