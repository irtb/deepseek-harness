import { useEffect, useState } from 'react'
import { AgentWorkspace } from './AgentWorkspace.tsx'
import { useAuth } from './auth.tsx'
import { consumeHandoffFromLocation, hrefWithoutHandoffParam } from './auth-handoff.ts'
import { buildCanvasLoginUrl } from './canvas-login-redirect.ts'
import { ThemeProvider } from './ThemeContext.tsx'
import './styles.css'

function CanvasLoginRedirect() {
  const loginUrl = buildCanvasLoginUrl(window.location.href)

  useEffect(() => {
    window.location.replace(loginUrl)
  }, [loginUrl])

  return (
    <main className="center-state">
      <p>正在前往统一登录…</p>
      <p><a href={loginUrl}>若未自动跳转，请点击继续</a></p>
    </main>
  )
}

function HandoffExchangeFailed() {
  const loginUrl = buildCanvasLoginUrl(hrefWithoutHandoffParam(window.location.href))

  return (
    <main className="center-state">
      <p>登录凭证无效或已过期，请重新登录。</p>
      <p><a href={loginUrl}>重新登录</a></p>
    </main>
  )
}

function AppContent() {
  const { ready, user, token, applySession } = useAuth()
  const [handoffStatus, setHandoffStatus] = useState<'checking' | 'idle' | 'failed'>(() =>
    new URL(window.location.href).searchParams.has('handoff') ? 'checking' : 'idle',
  )

  useEffect(() => {
    if (handoffStatus !== 'checking') return
    void consumeHandoffFromLocation(applySession).then((result) => {
      setHandoffStatus(result === 'failed' ? 'failed' : 'idle')
    })
  }, [applySession, handoffStatus])

  if (handoffStatus === 'checking') {
    return <main className="center-state">正在兑换登录凭证…</main>
  }
  if (handoffStatus === 'failed') {
    return <HandoffExchangeFailed />
  }
  if (!ready) return <main className="center-state">正在恢复登录状态…</main>
  if (user === null || token === null) return <CanvasLoginRedirect />
  return <AgentWorkspace mode={window.location.pathname.includes('video-generator') ? 'video' : 'image'} />
}

export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>
}
