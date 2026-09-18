import { AgentWorkspace } from './AgentWorkspace.tsx'
import { useAuth } from './auth.tsx'
import { LoginView } from './LoginView.tsx'
import { ThemeProvider } from './ThemeContext.tsx'
import './styles.css'

function AppContent() {
  const { ready, user, token } = useAuth()
  if (!ready) return <main className="center-state">正在恢复登录状态…</main>
  if (user === null || token === null) return <LoginView />
  return <AgentWorkspace mode={window.location.pathname.includes('video-generator') ? 'video' : 'image'} />
}

export function App() {
  return <ThemeProvider><AppContent /></ThemeProvider>
}
