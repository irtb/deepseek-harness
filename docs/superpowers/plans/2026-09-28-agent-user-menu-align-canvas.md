# Agent UserMenu Align Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Agent top-right personal-info dropdown visuals with Canvas `UserMenu` (icons, theme switch, logout, spacing) without changing business behavior.

**Architecture:** Keep Agent’s BEM CSS + hover/focus panel. Add small inline-SVG icon helpers inside `UserMenu.tsx` (no lucide/Tailwind). Update markup structure and CSS (including light theme) to mirror Canvas chrome. Tests assert visible chrome labels and theme switch accessibility.

**Tech Stack:** React 18, Vite, Vitest, Testing Library; plain CSS BEM under `styles.css`.

## Global Constraints

- Scope: `agent.shotgo.cn/apps/shotgo-agent-web` only (no canvas/api/console edits).
- Visual authority: `canvas.shotgo.cn/src/components/auth/UserMenu.tsx`.
- No new dependencies (`lucide-react`, Tailwind).
- Do not change `teamMenuFlags`, navigation targets, team create/switch, credits semantics, or logout flow.
- Do not commit unless the user explicitly asks.
- Follow TDD: failing test before production code for each behavior unit.
- Spec: `docs/superpowers/specs/2026-09-28-agent-user-menu-align-canvas-design.md`.

---

## File Map

| File | Role |
|------|------|
| `apps/shotgo-agent-web/tests/user-menu.spec.tsx` | Panel chrome assertions |
| `apps/shotgo-agent-web/src/UserMenu.tsx` | Markup + inline SVG icons |
| `apps/shotgo-agent-web/src/styles.css` | `.user-menu*` layout/theme styles |

---

### Task 1: Expand UserMenu chrome tests

**Files:**
- Modify: `apps/shotgo-agent-web/tests/user-menu.spec.tsx`

**Interfaces:**
- Consumes: existing `UserMenu`, `AuthProvider`, `ThemeProvider`
- Produces: failing expectations that require section title, logout button, and SVG-based theme switch (no emoji)

- [ ] **Step 1: Write the failing / expanded test**

Replace/extend `apps/shotgo-agent-web/tests/user-menu.spec.tsx` so it includes:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { UserMenu } from '../src/UserMenu.tsx'

function seedUser() {
  const user = {
    id: 7,
    name: 'Alice Agent',
    email: 'alice@example.test',
    credits: 42,
    account_kind: 'normal' as const,
    is_vip: false,
  }
  localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
  localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })),
  )
  return user
}

describe('UserMenu', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('renders the user display name', () => {
    seedUser()
    render(
      <ThemeProvider>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </ThemeProvider>,
    )
    expect(screen.getAllByText('Alice Agent').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '用户信息' })).toBeInTheDocument()
  })

  it('renders canvas-aligned panel chrome', () => {
    seedUser()
    render(
      <ThemeProvider>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </ThemeProvider>,
    )

    expect(screen.getByText('个人信息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.getByText('模式切换')).toBeInTheDocument()

    const themeSwitch = screen.getByRole('switch')
    expect(themeSwitch).toBeInTheDocument()
    expect(themeSwitch.textContent ?? '').not.toMatch(/[☀☾]/)
    expect(themeSwitch.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to see current gap**

Run (from `agent.shotgo.cn`):

```bash
pnpm --filter @shotgo/agent-web test -- tests/user-menu.spec.tsx
```

Expected: `renders the user display name` PASS; `renders canvas-aligned panel chrome` FAIL on emoji / missing SVG in theme switch (logout / 个人信息 may already pass).

---

### Task 2: Inline icons + UserMenu markup

**Files:**
- Modify: `apps/shotgo-agent-web/src/UserMenu.tsx`

**Interfaces:**
- Produces: local `MenuIcon` helpers used only by `UserMenu`
- Consumes: unchanged auth/theme/team APIs

- [ ] **Step 1: Add icon helpers at top of `UserMenu.tsx` (after imports)**

```tsx
type IconProps = { className?: string; size?: number }

function iconProps({ className, size = 16 }: IconProps) {
  return {
    className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

function UserIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function PlusIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

function UsersIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function ContrastIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a10 10 0 0 1 0 20z" />
    </svg>
  )
}

function SunIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function LogOutIcon(props: IconProps) {
  return (
    <svg {...iconProps({ ...props, size: props.size ?? 14 })}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )
}

function CloseIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}
```

- [ ] **Step 2: Update panel chrome markup (logic untouched)**

Key JSX replacements inside the existing panel:

```tsx
{/* section title */}
<div className="user-menu__section-title">
  <UserIcon className="user-menu__section-icon" />
  <span>个人信息</span>
</div>

{/* team actions — wrap label with icon; keep same onClick/disabled */}
<button type="button" className="user-menu__action" onClick={openCreateModal}>
  <PlusIcon />
  创建团队
</button>
{/* showEnter → <UsersIcon /> 进入团队 */}
{/* showSwitchPersonal → <UserIcon size={14} /> 切换个人账户 */}
{/* showManage / showView → <UsersIcon /> */}

{/* theme row */}
<div className="user-menu__theme">
  <span className="user-menu__theme-label">
    <ContrastIcon className="user-menu__theme-icon" />
    模式切换
  </span>
  <button
    type="button"
    role="switch"
    aria-checked={isDark}
    aria-label={isDark ? '切换为浅色模式' : '切换为深色模式'}
    className="user-menu__theme-switch"
    onClick={() => setTheme(isDark ? 'light' : 'dark')}
  >
    <span className={!isDark ? 'is-active' : undefined}>
      <SunIcon />
    </span>
    <span className={isDark ? 'is-active' : undefined}>
      <MoonIcon />
    </span>
  </button>
</div>

{/* logout */}
<button type="button" className="user-menu__logout" onClick={() => void handleLogout()}>
  <LogOutIcon />
  退出登录
</button>
```

Modal close button: replace `×` text with `<CloseIcon />` (keep `aria-label="关闭"`).

- [ ] **Step 3: Re-run chrome test**

```bash
pnpm --filter @shotgo/agent-web test -- tests/user-menu.spec.tsx
```

Expected: chrome assertions PASS for SVG theme switch; layout may still look unfinished until CSS task.

---

### Task 3: CSS alignment (dark + light)

**Files:**
- Modify: `apps/shotgo-agent-web/src/styles.css` (`.user-menu*` block ~44–116 and light overrides ~795–817)

**Interfaces:**
- Consumes: new class names `user-menu__section-icon`, `user-menu__theme-label`, `user-menu__theme-icon`

- [ ] **Step 1: Update base (dark) rules**

Replace/extend the existing user-menu CSS so it matches Canvas density:

```css
.user-menu__section-title {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px; padding-bottom: 8px;
  border-bottom: 1px solid #2a2c33; color: #f4f5f7; font-size: 13px; font-weight: 500;
}
.user-menu__section-icon { color: #8e929d; flex-shrink: 0; }
.user-menu__action {
  display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px; border: 1px solid #34353d; border-radius: 10px;
  color: #d7dae0; background: transparent; cursor: pointer; font: inherit;
}
.user-menu__theme-label { display: inline-flex; align-items: center; gap: 8px; }
.user-menu__theme-icon { color: #8e929d; flex-shrink: 0; }
.user-menu__theme-switch span {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%;
  color: #8e929d;
}
.user-menu__theme-switch span.is-active { color: #f4f5f7; background: #25272e; box-shadow: 0 1px 4px #0005; }
.user-menu__logout {
  display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 6px;
  margin-top: 12px; padding: 8px 10px;
  border: 1px solid #34353d; border-radius: 10px; color: #d7dae0; background: transparent; cursor: pointer; font: inherit;
}
.user-menu-modal__head button {
  display: inline-grid; place-items: center; padding: 4px; border: 0; border-radius: 6px;
  color: #8e929d; background: transparent; cursor: pointer;
}
.user-menu-modal__head button:hover { color: #f4f5f7; background: #22242b; }
```

Keep existing trigger / avatar / panel / row / vip / credits / storage / modal card rules; only adjust if needed for 14px radius / padding already present.

- [ ] **Step 2: Extend light-theme overrides**

Add alongside existing light user-menu rules (~795+):

```css
:root[data-theme='light'] .user-menu__section-icon,
:root[data-theme='light'] .user-menu__theme-icon { color: #98a2b3; }
:root[data-theme='light'] .user-menu__theme-switch span { color: #98a2b3; }
:root[data-theme='light'] .user-menu__theme-switch span.is-active { color: #175cd3; background: #fff; }
:root[data-theme='light'] .user-menu-modal__head button:hover { color: #101828; background: #eef2f7; }
```

- [ ] **Step 3: Re-run tests + typecheck**

```bash
pnpm --filter @shotgo/agent-web test -- tests/user-menu.spec.tsx
pnpm --filter @shotgo/agent-web typecheck
```

Expected: all PASS.

---

### Task 4: Regression + acceptance check

**Files:**
- None (verification only)

- [ ] **Step 1: Run full agent-web test suite**

```bash
pnpm --filter @shotgo/agent-web test
```

Expected: PASS (no regressions in workspace / auth tests).

- [ ] **Step 2: Manual visual checklist (local `pnpm --filter @shotgo/agent-web dev`)**

Compare Agent vs Canvas logged-in header dropdown:

1. Title row has user icon +「个人信息」
2. Theme switch uses Sun/Moon glyphs (no ☀/☾)
3. Logout has exit icon; hover turns reddish
4. Team action buttons (if visible) show leading icons and stay centered
5. Light theme: panel/icons readable; switch active state clear
6. Create-team modal close uses X icon; create/cancel still work

- [ ] **Step 3: Commit only if user asks**

If user requests commit, message:

```bash
git add apps/shotgo-agent-web/src/UserMenu.tsx \
  apps/shotgo-agent-web/src/styles.css \
  apps/shotgo-agent-web/tests/user-menu.spec.tsx \
  docs/superpowers/specs/2026-09-28-agent-user-menu-align-canvas-design.md \
  docs/superpowers/plans/2026-09-28-agent-user-menu-align-canvas.md
git commit -m "$(cat <<'EOF'
align Agent UserMenu chrome with Canvas visuals

EOF
)"
```

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Title + user icon | Task 2 + 3 |
| Team action icons / centered buttons | Task 2 + 3 |
| Contrast + Sun/Moon switch | Task 1–3 |
| Logout icon + hover | Task 2 + 3 |
| Geometry / density | Task 3 |
| Light theme | Task 3 |
| No Canvas / no new deps / logic unchanged | Global Constraints |
| Vitest + manual acceptance | Task 1, 4 |
| Modal light visual alignment | Task 2 (CloseIcon) + 3 |

No placeholders remaining. Icon helper names consistent across Task 2–3.
