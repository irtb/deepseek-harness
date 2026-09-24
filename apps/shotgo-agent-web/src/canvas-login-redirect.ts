export function canvasBaseUrl(): string {
  return String(import.meta.env.VITE_CANVAS_APP_BASE_URL ?? 'https://canvas.shotgo.cn').replace(/\/$/, '')
}

export function buildCanvasLoginUrl(currentHref: string, canvasBase?: string): string {
  const base = (canvasBase ?? canvasBaseUrl()).replace(/\/$/, '')
  return `${base}/login?continue=${encodeURIComponent(currentHref)}`
}
