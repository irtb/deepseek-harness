import { canvasBaseUrl } from './canvas-login-redirect.ts'

/**
 * Build an absolute Canvas app URL from a relative path.
 * Rejects open redirects (absolute URLs, protocol-relative, origin escape).
 */
export function canvasAppUrl(path: string, canvasBase?: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Invalid canvas app path')
  }

  const base = (canvasBase ?? canvasBaseUrl()).replace(/\/$/, '')
  let baseOrigin: string
  try {
    baseOrigin = new URL(base).origin
  } catch {
    throw new Error('Invalid canvas base URL')
  }

  let resolved: URL
  try {
    resolved = new URL(path, `${baseOrigin}/`)
  } catch {
    throw new Error('Invalid canvas app path')
  }

  if (resolved.origin !== baseOrigin) {
    throw new Error('Open redirect rejected')
  }

  return `${base}${resolved.pathname}${resolved.search}${resolved.hash}`
}
