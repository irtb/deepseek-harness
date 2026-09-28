import type { AuthUser } from './auth.tsx'
import { parseAuthUser } from './auth.tsx'

export interface SpaceSummary {
  uuid: string
  name: string
  firstProjectUuid: string | null
  canvasCount: number
}

/** Preferred Space name for automatic binding; created only when the visible list is empty. */
export const DEFAULT_SPACE_NAME = '默认项目'

export function preferredSpace(spaces: SpaceSummary[]): SpaceSummary | undefined {
  return spaces.find(item => item.name === DEFAULT_SPACE_NAME) ?? spaces[0]
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

export async function createSpace(token: string, name: string): Promise<SpaceSummary> {
  const data = await request<{
    space: { uuid: string; name: string }
    defaultProject: { uuid: string; name: string }
  }>('/api/spaces', token, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (typeof data.space?.uuid !== 'string' || typeof data.space.name !== 'string'
    || typeof data.defaultProject?.uuid !== 'string') {
    throw new Error('创建项目失败')
  }
  return {
    uuid: data.space.uuid,
    name: data.space.name,
    firstProjectUuid: data.defaultProject.uuid,
    canvasCount: 1,
  }
}

export async function switchActiveTeam(token: string, teamId: number | null): Promise<AuthUser> {
  const raw = await request<AuthUser>('/api/teams/active', token, {
    method: 'POST',
    body: JSON.stringify({ team_id: teamId }),
  })
  const user = parseAuthUser(raw)
  if (user === null) throw new Error('切换团队失败')
  return user
}
