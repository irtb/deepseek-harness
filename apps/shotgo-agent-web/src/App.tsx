import { useEffect } from 'react'
import { AgentWorkspace } from './AgentWorkspace.tsx'
import { useAuth } from './auth.tsx'
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

function AppContent() {
  const { ready, user, token } = useAuth()
  if (!ready) return <main className="center-state">正在恢复登录状态…</main>
  if (user === null || token === null) return <CanvasLoginRedirect />
  return <AgentWorkspace mode={window.location.pathname.includes('video-generator') ? 'video' : 'image'} />
}

export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>
}
