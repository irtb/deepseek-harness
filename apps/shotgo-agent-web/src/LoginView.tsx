import { useState, type FormEvent } from 'react'
import { useAuth } from './auth.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

export function LoginView() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-shell">
      <div className="login-theme"><ThemeToggle /></div>
      <form className="login-card" onSubmit={event => void submit(event)}>
        <div className="login-brand"><span className="brand-mark">S</span><div><h1>登录 ShotGo Agent</h1><p>在独立工作台继续图片和视频创作</p></div></div>
        <label>邮箱<input type="email" autoComplete="email" required value={email} onChange={(event) =>{  setEmail(event.target.value) }} /></label>
        <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={(event) =>{  setPassword(event.target.value) }} /></label>
        {error === undefined ? null : <p className="form-error" role="alert">{error}</p>}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
    </main>
  )
}
