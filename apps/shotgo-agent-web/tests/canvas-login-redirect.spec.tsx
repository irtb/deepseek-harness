import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { buildCanvasLoginUrl } from '../src/canvas-login-redirect.ts'

describe('buildCanvasLoginUrl', () => {
  it('builds login URL with continue param', () => {
    expect(
      buildCanvasLoginUrl('http://localhost:3011/ai-tool/image-generator', 'https://canvas.shotgo.cn'),
    ).toBe(
      'https://canvas.shotgo.cn/login?continue=' + encodeURIComponent('http://localhost:3011/ai-tool/image-generator'),
    )
  })

  it('defaults to production canvas base when unset', () => {
    expect(buildCanvasLoginUrl('https://agent.shotgo.cn/ai-tool/video-generator')).toBe(
      'https://canvas.shotgo.cn/login?continue=' + encodeURIComponent('https://agent.shotgo.cn/ai-tool/video-generator'),
    )
  })

  it('strips trailing slash from canvas base', () => {
    expect(
      buildCanvasLoginUrl('http://localhost:3011/', 'https://canvas.shotgo.cn/'),
    ).toBe(
      'https://canvas.shotgo.cn/login?continue=' + encodeURIComponent('http://localhost:3011/'),
    )
  })
})

describe('CanvasLoginRedirect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('redirects unauthenticated users via location.replace with fallback link', () => {
    const replace = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      href: 'http://localhost:3011/ai-tool/image-generator',
      replace,
    })

    render(
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>,
    )

    const loginUrl = buildCanvasLoginUrl('http://localhost:3011/ai-tool/image-generator', 'https://canvas.shotgo.cn')
    expect(screen.getByText('正在前往统一登录…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '若未自动跳转，请点击继续' })).toHaveAttribute('href', loginUrl)
    expect(replace).toHaveBeenCalledWith(loginUrl)
  })
})
