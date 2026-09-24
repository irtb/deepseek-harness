import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import {
  consumeHandoffFromLocation,
  exchangeHandoff,
  hrefWithoutHandoffParam,
} from '../src/auth-handoff.ts'
import { buildCanvasLoginUrl } from '../src/canvas-login-redirect.ts'

const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }

function stubLocation(href: string) {
  vi.stubGlobal('location', { ...window.location, href, replace: vi.fn() })
}

describe('exchangeHandoff', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs code to handoff exchange endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'handoff-token', user }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await exchangeHandoff('abc123')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.shotgo.cn/api/auth/handoff/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'abc123' }),
      }),
    )
    expect(result).toEqual({ token: 'handoff-token', user })
  })

  it('throws when exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(exchangeHandoff('bad')).rejects.toThrow('登录凭证兑换失败')
  })
})

describe('consumeHandoffFromLocation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('returns missing when handoff param is absent', async () => {
    stubLocation('http://localhost:3011/ai-tool/image-generator')
    const applySession = vi.fn()
    await expect(consumeHandoffFromLocation(applySession)).resolves.toBe('missing')
    expect(applySession).not.toHaveBeenCalled()
  })

  it('applies session and strips handoff from URL on success', async () => {
    stubLocation('http://localhost:3011/ai-tool/image-generator?handoff=abc123')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'handoff-token', user }), { status: 200 }),
    ))
    const applySession = vi.fn()

    await expect(consumeHandoffFromLocation(applySession)).resolves.toBe('ok')

    expect(applySession).toHaveBeenCalledWith('handoff-token', user)
    expect(replaceState).toHaveBeenCalledWith(
      {},
      '',
      '/ai-tool/image-generator',
    )
  })

  it('returns failed when exchange throws', async () => {
    stubLocation('http://localhost:3011/?handoff=expired')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 422 })))
    const applySession = vi.fn()

    await expect(consumeHandoffFromLocation(applySession)).resolves.toBe('failed')
    expect(applySession).not.toHaveBeenCalled()
  })
})

describe('hrefWithoutHandoffParam', () => {
  it('removes handoff query while preserving other params', () => {
    expect(
      hrefWithoutHandoffParam('http://localhost:3011/ai-tool/image-generator?handoff=abc&foo=1'),
    ).toBe('http://localhost:3011/ai-tool/image-generator?foo=1')
  })
})

describe('App handoff flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not redirect to Canvas while handoff exchange is in progress', async () => {
    const replace = vi.fn()
    let resolveExchange: ((value: Response) => void) | undefined
    stubLocation('http://localhost:3011/ai-tool/image-generator?handoff=pending')
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost:3011/ai-tool/image-generator?handoff=pending', replace })
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveExchange = resolve
    })))

    render(
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>,
    )

    expect(screen.getByText('正在兑换登录凭证…')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()

    resolveExchange?.(new Response(JSON.stringify({ token: 'handoff-token', user }), { status: 200 }))
    await waitFor(() => {
      expect(replace).not.toHaveBeenCalled()
    })
  })

  it('shows rebuild login link when handoff exchange fails', async () => {
    const replace = vi.fn()
    stubLocation('http://localhost:3011/ai-tool/image-generator?handoff=bad')
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost:3011/ai-tool/image-generator?handoff=bad', replace })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    render(
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>,
    )

    const loginUrl = buildCanvasLoginUrl('http://localhost:3011/ai-tool/image-generator')
    await waitFor(() => {
      expect(screen.getByText(/登录凭证无效或已过期/)).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: '重新登录' })).toHaveAttribute('href', loginUrl)
    expect(replace).not.toHaveBeenCalled()
  })
})
