export type LibraryScope = 'personal' | 'group' | 'team'
export type ReferenceMediaKind = 'image' | 'video'

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

export const MAX_LIBRARY_UPLOAD_BYTES = 30 * 1024 * 1024
export const REFERENCE_UPLOAD_ACCEPT = 'image/*,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov'

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

export function mediaTypeFromFile(file: File): ReferenceMediaKind | undefined {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== undefined && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (ext !== undefined && ['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  return undefined
}

function firstProblem(body: { msg?: unknown; message?: unknown; errors?: unknown } | null): string | undefined {
  if (typeof body?.msg === 'string' && body.msg.length > 0) return body.msg
  if (body?.errors !== null && typeof body?.errors === 'object') {
    for (const value of Object.values(body.errors as Record<string, unknown>)) {
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  if (typeof body?.message === 'string' && body.message.length > 0) return body.message
  return undefined
}

function humanizeProblem(raw: string): string {
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === 'validation.uploaded'
    || normalized.includes('failed to upload')
    || normalized === '文件上传失败'
    || normalized === '文件上传失败。'
  ) {
    return '文件超过服务器上传限制，请压缩到 30MB 以内后重试'
  }
  return raw
}

function problemMessage(body: { msg?: unknown; message?: unknown; errors?: unknown } | null, fallback: string): string {
  const raw = firstProblem(body)
  return raw === undefined ? fallback : humanizeProblem(raw)
}

export async function fetchMediaLibrary(input: {
  token: string
  scope: LibraryScope
  page: number
  type?: ReferenceMediaKind
  pageSize?: number
  signal?: AbortSignal
}): Promise<MediaLibraryPage> {
  const query = new URLSearchParams({
    scope: input.scope,
    type: input.type ?? 'image',
    page: String(input.page),
    page_size: String(input.pageSize ?? 15),
  })
  const response = await fetch(`${apiBase()}/api/media/library?${query}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = (await response.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: unknown } | null
  if (!response.ok || body?.code !== 0 || typeof body.data !== 'object' || body.data === null)
    throw new Error(problemMessage(body, '加载素材库失败'))
  return body.data as MediaLibraryPage
}

export async function uploadMediaLibraryFile(input: {
  token: string
  file: File
  mediaType?: ReferenceMediaKind
  signal?: AbortSignal
}): Promise<MediaLibraryItem> {
  if (input.file.size <= 0) throw new Error('文件为空')
  if (input.file.size > MAX_LIBRARY_UPLOAD_BYTES) throw new Error('请上传小于 30MB 的文件')
  const mediaType = input.mediaType ?? mediaTypeFromFile(input.file)
  if (mediaType === undefined) throw new Error('仅支持图片或视频（jpg/png/webp/gif、mp4/webm/mov）')
  const form = new FormData()
  form.append('file', input.file)
  form.append('media_type', mediaType)
  const response = await fetch(`${apiBase()}/api/media/library/upload`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.token}` },
    body: form,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const body = (await response.json().catch(() => null)) as { code?: unknown; msg?: unknown; data?: unknown } | null
  if (!response.ok || body?.code !== 0 || typeof body.data !== 'object' || body.data === null)
    throw new Error(problemMessage(body, '上传失败'))
  const item = body.data as MediaLibraryItem
  if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error('上传失败')
  return item
}
