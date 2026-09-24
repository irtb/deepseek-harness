export function canvasOrigin(): string {
  return String(import.meta.env.VITE_SHOTGO_CANVAS_ORIGIN ?? 'https://canvas.shotgo.cn').replace(/\/$/, '')
}

export function buildCanvasAppUrl(path: string, configuredOrigin?: string): string {
  const candidate = (configuredOrigin ?? canvasOrigin()).trim() || 'https://canvas.shotgo.cn'
  const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username
    || parsed.password
  ) {
    throw new Error('INVALID_CANVAS_APP_URL')
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${parsed.origin}${normalizedPath}`
}
