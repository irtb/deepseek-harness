import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { UserMenu } from '../src/UserMenu.tsx'

describe('UserMenu', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('renders the user display name', () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })))

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
})
