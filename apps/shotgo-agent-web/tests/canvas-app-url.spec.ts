import { describe, expect, it } from 'vitest'
import { buildCanvasAppUrl, canvasOrigin } from '../src/canvas-app-url.ts'

describe('canvas-app-url', () => {
  it('defaults origin to production canvas', () => {
    expect(canvasOrigin()).toBe('https://canvas.shotgo.cn')
  })

  it('builds absolute canvas paths without trailing slash on origin', () => {
    expect(buildCanvasAppUrl('/projects', 'https://canvas.shotgo.cn/')).toBe(
      'https://canvas.shotgo.cn/projects',
    )
    expect(buildCanvasAppUrl('/ai-tool/batch-image', 'http://localhost:5173')).toBe(
      'http://localhost:5173/ai-tool/batch-image',
    )
  })

  it('rejects invalid origins', () => {
    expect(() => buildCanvasAppUrl('/projects', 'ftp://canvas.shotgo.cn')).toThrow('INVALID_CANVAS_APP_URL')
    expect(() => buildCanvasAppUrl('/projects', 'https://user:pass@canvas.shotgo.cn')).toThrow(
      'INVALID_CANVAS_APP_URL',
    )
  })
})
