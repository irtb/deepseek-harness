import type { AuthUser } from './auth.tsx'
import { parseAuthUser } from './auth.tsx'

function base(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

export interface CreateTeamResult {
  team: { id: number; code: string; name: string }
  user: AuthUser
}

async function problemMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: unknown; msg?: unknown } | null
  return typeof body?.message === 'string'
    ? body.message
    : typeof body?.msg === 'string'
      ? body.msg
      : fallback
}

export async function createTeam(token: string, name: string): Promise<CreateTeamResult> {
  const response = await fetch(`${base()}/api/teams`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(await problemMessage(response, '创建团队失败'))
  const body = await response.json() as {
    team?: { id?: number; code?: string; name?: string }
    user?: unknown
  }
  const user = parseAuthUser(body.user)
  if (user === null) throw new Error('创建团队失败：无效用户')
  const team = body.team
  if (typeof team?.id !== 'number' || typeof team.code !== 'string') {
    throw new Error('创建团队失败：无效团队')
  }
  return {
    team: { id: team.id, code: team.code, name: team.name ?? '' },
    user,
  }
}
