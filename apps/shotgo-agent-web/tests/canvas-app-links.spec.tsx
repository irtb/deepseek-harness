import { describe, expect, it } from 'vitest'
import { canvasAppUrl } from '../src/canvas-app-links.ts'

describe('canvasAppUrl', () => {
  it('joins relative paths to the canvas base', () => {
    expect(canvasAppUrl('/user/credits', 'https://canvas.shotgo.cn')).toBe(
      'https://canvas.shotgo.cn/user/credits',
    )
    expect(canvasAppUrl('/team/abc/users', 'https://canvas.shotgo.cn/')).toBe(
      'https://canvas.shotgo.cn/team/abc/users',
    )
  })

  it('preserves query and hash', () => {
    expect(canvasAppUrl('/user/credits?tab=1#x', 'https://canvas.shotgo.cn')).toBe(
      'https://canvas.shotgo.cn/user/credits?tab=1#x',
    )
  })

  it('rejects open redirects', () => {
    expect(() => canvasAppUrl('https://evil.example/phish', 'https://canvas.shotgo.cn')).toThrow()
    expect(() => canvasAppUrl('//evil.example/phish', 'https://canvas.shotgo.cn')).toThrow()
    expect(() => canvasAppUrl('\\evil.example', 'https://canvas.shotgo.cn')).toThrow()
    expect(() => canvasAppUrl('user/credits', 'https://canvas.shotgo.cn')).toThrow()
    expect(() => canvasAppUrl('', 'https://canvas.shotgo.cn')).toThrow()
  })

  it('defaults to production canvas base when unset', () => {
    expect(canvasAppUrl('/login')).toBe('https://canvas.shotgo.cn/login')
  })
})
