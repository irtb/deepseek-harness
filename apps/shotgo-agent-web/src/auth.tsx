import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { canvasBaseUrl } from './canvas-login-redirect.ts'

const TOKEN_KEY = 'shotgo-agent-access-token'
const USER_KEY = 'shotgo-agent-user'

export interface UserMembership {
  plan_id: number
  plan_slug: string
  plan_name: string
  billing_cycle: 'permanent' | 'monthly'
  expires_at: string | null
  is_vip: boolean
}

export interface UserStorage {
  used_bytes: number
  quota_bytes: number
  available_bytes: number
  used_label: string
  quota_label: string
  usage_label: string
  team_used_bytes?: number
  team_quota_bytes?: number
  user_used_bytes?: number
  user_usage_label?: string
}

export interface AuthUser {
  id: number
  name: string
  email: string
  credits: number
  user_type?: 'normal' | 'team'
  account_kind?: 'normal' | 'team_member'
  active_team_id?: number | null
  team_role?: 'owner' | 'admin' | 'group_admin' | 'member' | null
  team?: { id: number; code: string; name: string } | null
  is_vip?: boolean
  membership?: UserMembership
  storage?: UserStorage
}

interface AuthContextValue {
  token: string | null
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  applyUser: (user: AuthUser) => void
  applySession: (token: string, user: AuthUser) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function apiBaseUrl(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

async function problemMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: unknown; detail?: unknown } | null
  return typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : fallback
}

function parseMembership(raw: unknown): UserMembership | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<UserMembership>
  if (typeof value.plan_slug !== 'string') return undefined
  return {
    plan_id: Number(value.plan_id ?? 0),
    plan_slug: value.plan_slug,
    plan_name: value.plan_name ?? '',
    billing_cycle: value.billing_cycle === 'monthly' ? 'monthly' : 'permanent',
    expires_at: value.expires_at ?? null,
    is_vip: Boolean(value.is_vip),
  }
}

function parseStorage(raw: unknown): UserStorage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<UserStorage>
  if (typeof value.quota_bytes !== 'number') return undefined
  const storage: UserStorage = {
    used_bytes: Number(value.used_bytes ?? 0),
    quota_bytes: value.quota_bytes,
    available_bytes: Number(value.available_bytes ?? 0),
    used_label: value.used_label ?? '0G',
    quota_label: value.quota_label ?? '0G',
    usage_label: value.usage_label ?? '0G/0G',
  }
  if (typeof value.team_used_bytes === 'number') storage.team_used_bytes = value.team_used_bytes
  if (typeof value.team_quota_bytes === 'number') storage.team_quota_bytes = value.team_quota_bytes
  if (typeof value.user_used_bytes === 'number') storage.user_used_bytes = value.user_used_bytes
  if (typeof value.user_usage_label === 'string') storage.user_usage_label = value.user_usage_label
  return storage
}

function parseTeam(raw: unknown): AuthUser['team'] {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<NonNullable<AuthUser['team']>>
  if (typeof value.id !== 'number' || typeof value.code !== 'string') return null
  return {
    id: value.id,
    code: value.code,
    name: value.name ?? '',
  }
}

function parseAccountKind(raw: unknown): AuthUser['account_kind'] | undefined {
  if (raw === 'normal' || raw === 'team_member') return raw
  return undefined
}

function parseTeamRole(raw: unknown): 'owner' | 'admin' | 'group_admin' | 'member' | null {
  if (raw === 'owner' || raw === 'admin' || raw === 'group_admin' || raw === 'member') return raw
  return null
}

function parseActiveTeamId(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (typeof raw === 'number') return raw
  return undefined
}

/** Normalize /api/me, login, and handoff user payloads (extra fields optional). */
export function parseAuthUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<AuthUser> & Record<string, unknown>
  if (typeof parsed.id !== 'number') return null

  const user: AuthUser = {
    id: parsed.id,
    name: typeof parsed.name === 'string' ? parsed.name : '',
    email: typeof parsed.email === 'string' ? parsed.email : '',
    credits: typeof parsed.credits === 'number' ? parsed.credits : 0,
  }

  if (parsed.user_type === 'team' || parsed.user_type === 'normal') user.user_type = parsed.user_type
  const accountKind = parseAccountKind(parsed.account_kind)
  if (accountKind !== undefined) user.account_kind = accountKind
  if ('team_role' in parsed) {
    const role = parseTeamRole(parsed.team_role)
    user.team_role = role
  }
  if ('active_team_id' in parsed) {
    const activeTeamId = parseActiveTeamId(parsed.active_team_id)
    if (activeTeamId !== undefined) user.active_team_id = activeTeamId
  }
  if ('team' in parsed) {
    user.team = parseTeam(parsed.team) ?? null
  }
  if ('is_vip' in parsed) user.is_vip = Boolean(parsed.is_vip)
  const membership = parseMembership(parsed.membership)
  if (membership !== undefined) user.membership = membership
  const storage = parseStorage(parsed.storage)
  if (storage !== undefined) user.storage = storage

  return user
}

function readStoredUser(): AuthUser | null {
  try {
    return parseAuthUser(JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'))
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser())
  const [ready, setReady] = useState(false)

  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  const applyUser = useCallback((next: AuthUser) => {
    const normalized = parseAuthUser(next) ?? next
    localStorage.setItem(USER_KEY, JSON.stringify(normalized))
    setUser(normalized)
  }, [])

  const applySession = useCallback((nextToken: string, nextUser: AuthUser) => {
    const normalized = parseAuthUser(nextUser) ?? nextUser
    localStorage.setItem(TOKEN_KEY, nextToken)
    localStorage.setItem(USER_KEY, JSON.stringify(normalized))
    setToken(nextToken)
    setUser(normalized)
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
      const body = await response.json() as { user: unknown }
      const next = parseAuthUser(body.user)
      if (next === null) throw new Error('AUTH_EXPIRED')
      applyUser(next)
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
    const body = await response.json() as { token: string; user: unknown }
    const nextUser = parseAuthUser(body.user)
    if (nextUser === null) throw new Error('登录失败')
    localStorage.setItem(TOKEN_KEY, body.token)
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
    setToken(body.token)
    setUser(nextUser)
  }, [])

  const logout = useCallback(async () => {
    if (token !== null) {
      await fetch(`${apiBaseUrl()}/api/logout`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }
    clear()
    window.location.replace(`${canvasBaseUrl()}/login`)
  }, [clear, token])

  const value = useMemo(
    () => ({ token, user, ready, login, logout, applyUser, applySession }),
    [applySession, applyUser, login, logout, ready, token, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === undefined) throw new Error('useAuth requires AuthProvider')
  return value
}
