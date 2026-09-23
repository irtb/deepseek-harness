import type { AuthUser } from './auth.tsx'
import { parseAuthUser } from './auth.tsx'

function apiBaseUrl(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

async function problemMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: unknown; detail?: unknown } | null
  return typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : fallback
}

export async function exchangeHandoff(code: string): Promise<{ token: string; user: AuthUser }> {
  const response = await fetch(`${apiBaseUrl()}/api/auth/handoff/exchange`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!response.ok) throw new Error(await problemMessage(response, '登录凭证兑换失败'))
  const body = await response.json() as { token: string; user: unknown }
  const user = parseAuthUser(body.user)
  if (user === null || typeof body.token !== 'string') throw new Error('登录凭证兑换失败')
  return { token: body.token, user }
}

export function hrefWithoutHandoffParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('handoff')
  return url.toString()
}

export async function consumeHandoffFromLocation(
  applySession: (token: string, user: AuthUser) => void,
): Promise<'ok' | 'missing' | 'failed'> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('handoff')
  if (!code) return 'missing'
  try {
    const body = await exchangeHandoff(code)
    applySession(body.token, body.user)
    url.searchParams.delete('handoff')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    return 'ok'
  } catch {
    return 'failed'
  }
}
