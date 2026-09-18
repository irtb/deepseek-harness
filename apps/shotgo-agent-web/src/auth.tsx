import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const TOKEN_KEY = 'shotgo-agent-access-token'
const USER_KEY = 'shotgo-agent-user'

export interface AuthUser {
  id: number
  name: string
  email: string
  credits: number
  active_team_id?: number | null
  team_role?: 'owner' | 'admin' | 'group_admin' | 'member' | null
  team?: { id: number; code: string; name: string } | null
}

interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  applyUser: (user: AuthUser) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function apiBaseUrl(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

async function problemMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: unknown; detail?: unknown } | null
  return typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : fallback
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as AuthUser | null
    } catch {
      return null
    }
  })
  const [ready, setReady] = useState(false)

  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const applyUser = useCallback((next: AuthUser) => {
    localStorage.setItem(USER_KEY, JSON.stringify(next))
    setUser(next)
  }, [])

  useEffect(() => {
    if (token === null) {
      setReady(true)
      return
    }
    const controller = new AbortController()
    void fetch(`${apiBaseUrl()}/api/me`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('AUTH_EXPIRED')
      const body = await response.json() as { user: AuthUser }
      applyUser(body.user)
    }).catch(() => {
      if (!controller.signal.aborted) clear()
    }).finally(() => {
      if (!controller.signal.aborted) setReady(true)
    })
    return () =>{  controller.abort() }
  }, [applyUser, clear, token])

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${apiBaseUrl()}/api/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) throw new Error(await problemMessage(response, '登录失败'))
    const body = await response.json() as { token: string; user: AuthUser }
    localStorage.setItem(TOKEN_KEY, body.token)
    localStorage.setItem(USER_KEY, JSON.stringify(body.user))
    setToken(body.token)
    setUser(body.user)
  }, [])

  const logout = useCallback(async () => {
    if (token !== null) {
      await fetch(`${apiBaseUrl()}/api/logout`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }
    clear()
  }, [clear, token])

  const value = useMemo(() => ({ token, user, ready, login, logout, applyUser }), [applyUser, login, logout, ready, token, user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === undefined) throw new Error('useAuth requires AuthProvider')
  return value
}
