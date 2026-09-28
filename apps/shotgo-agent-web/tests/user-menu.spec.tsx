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
