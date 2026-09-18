import type { AuthUser } from './auth.tsx'

export interface SpaceSummary {
  uuid: string
  name: string
  firstProjectUuid: string | null
  canvasCount: number
}

function base(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  const body = (await response.json().catch(() => null)) as {
    code?: number
    data?: T
    message?: string
    msg?: string
    user?: AuthUser
  } | null
  if (!response.ok || body === null || (body.code !== undefined && body.code !== 0))
    throw new Error(body?.message ?? body?.msg ?? '加载授权上下文失败')
  return (body.data ?? body.user) as T
}

export async function fetchSpaces(token: string): Promise<SpaceSummary[]> {
  const data = await request<{ list: SpaceSummary[] }>('/api/spaces?per_page=100', token)
  return data.list
}

export async function switchActiveTeam(token: string, teamId: number | null): Promise<AuthUser> {
  return request<AuthUser>('/api/teams/active', token, { method: 'POST', body: JSON.stringify({ team_id: teamId }) })
}
