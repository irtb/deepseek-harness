export type LibraryScope = 'personal' | 'group' | 'team'

export interface MediaLibraryItem {
  id: number
  mediaType: 'image' | 'video' | 'audio' | 'portrait'
  path: string
  thumbPath: string | null
  originalName: string | null
  visibility: 'private' | 'group' | 'team'
  createdAtMs: number | null
}

export interface MediaLibraryPage {
  list: MediaLibraryItem[]
  pagination: { page: number; per_page: number; total: number; last_page: number }
}

function apiBase(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

export function resolveMediaUrl(path: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path
  const normalized = path.replace(/^\//, '')
  if (normalized.startsWith('uploads/')) return `${apiBase()}/${normalized}`
  const resourceBase = String(import.meta.env.VITE_SHOTGO_RESOURCE_BASE_URL ?? apiBase()).replace(/\/$/, '')
  return `${resourceBase}/${normalized}`
}

export async function fetchMediaLibrary(input: {
  token: string
  scope: LibraryScope
  page: number
  pageSize?: number
  signal?: AbortSignal
}): Promise<MediaLibraryPage> {
  const query = new URLSearchParams({
    scope: input.scope,
    type: 'image',
    page: String(input.page),
    page_size: String(input.pageSize ?? 15),
  })
  const response = await fetch(`${apiBase()}/api/media/library?${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = (await response.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: unknown } | null
  if (!response.ok || body?.code !== 0 || typeof body.data !== 'object' || body.data === null)
    throw new Error(typeof body?.msg === 'string' ? body.msg : '加载素材库失败')
  return body.data as MediaLibraryPage
}
