import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWorkspace } from '../src/AgentWorkspace.tsx'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { newSession, sessionScope, writeSessions } from '../src/session-store.ts'

const requestUrl = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

describe('AgentWorkspace mode-tabs', () => {
  beforeEach(() => {
    localStorage.clear()
    const user = {
      id: 7,
      name: 'fixture',
      email: 'fixture@example.test',
      credits: 100,
      active_team_id: null,
      team: null,
    }
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    // Seed a stable session so AgentWorkspace does not allocate a new id each render.
    writeSessions(localStorage, sessionScope(7, null, 'image'), [newSession('image')])
    writeSessions(localStorage, sessionScope(7, null, 'video'), [newSession('video')])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input)
        if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
        if (url.includes('/api/spaces')) {
          return new Response(JSON.stringify({ code: 0, data: { list: [] } }))
        }
        if (url.includes('generation-config')) return new Response('{}', { status: 500 })
        if (url.includes('creative-sessions')) return new Response('{}', { status: 404 })
        if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
        throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
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
