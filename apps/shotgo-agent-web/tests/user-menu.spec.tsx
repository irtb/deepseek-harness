import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { UserMenu } from '../src/UserMenu.tsx'

describe('user menu hover target', () => {
  it('attaches the dropdown to the trigger so logout stays clickable', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/styles.css'), 'utf8')
    const panel = css.match(/\.user-menu__panel \{[^}]+\}/)?.[0] ?? ''
    expect(panel).toContain('top: 100%')
    expect(panel).toContain('padding-top: 8px')
    expect(panel).not.toContain('calc(100% + 8px)')
    expect(css).toContain('.user-menu__card')
  })
})

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

  it('redirects logout to the canvas login page', async () => {
    const user = {
      id: 7,
      name: 'Alice Agent',
      email: 'alice@example.test',
      credits: 42,
    }
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost:3011/', replace })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/me')) {
        return new Response(JSON.stringify({ user }), { status: 200 })
      }
      if (url.endsWith('/api/logout')) {
        return new Response(JSON.stringify({ message: '已退出登录' }), { status: 200 })
      }
      return new Response('{}', { status: 500 })
    }))

    render(
      <ThemeProvider>
        <AuthProvider>
          <UserMenu />
        </AuthProvider>
      </ThemeProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('https://canvas.shotgo.cn/login')
    })
    expect(localStorage.getItem('shotgo-agent-access-token')).toBeNull()
  })
})
