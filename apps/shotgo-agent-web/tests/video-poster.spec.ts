import { describe, expect, it, vi } from 'vitest'
import {
  captureVideoFrame,
  formatDurationLabel,
  isLikelyImageUrl,
  resolvePosterSrc,
} from '../src/video-poster.ts'

describe('video poster helpers', () => {
  it('detects image urls and rejects same-as-video thumbnails', () => {
    expect(isLikelyImageUrl('https://cdn.example/a.jpg')).toBe(true)
    expect(isLikelyImageUrl('https://cdn.example/a.mp4')).toBe(false)
    expect(resolvePosterSrc({
      url: 'https://cdn.example/a.mp4',
      thumbnailUrl: 'https://cdn.example/a.mp4',
    })).toBeUndefined()
    expect(resolvePosterSrc({
      url: 'https://cdn.example/a.mp4',
      thumbnailUrl: 'https://cdn.example/a.jpg',
    })).toBe('https://cdn.example/a.jpg')
  })

  it('formats short duration labels', () => {
    expect(formatDurationLabel(5)).toBe('5s')
    expect(formatDurationLabel(65)).toBe('1:05')
    expect(formatDurationLabel(undefined)).toBeUndefined()
  })

  it('returns undefined when capture cannot load media', async () => {
    const realCreate = document.createElement.bind(document)
    const video = {
      muted: false,
      playsInline: false,
      preload: '',
      crossOrigin: null as string | null,
      src: '',
      readyState: 0,
      duration: Number.NaN,
      currentTime: 0,
      videoWidth: 0,
      videoHeight: 0,
      load() {},
      removeAttribute() {},
      addEventListener(type: string, handler: () => void) {
        if (type === 'error') queueMicrotask(handler)
      },
      removeEventListener() {},
    }
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'video') return video as unknown as HTMLVideoElement
      return realCreate(tagName)
    }) as typeof document.createElement)

    await expect(captureVideoFrame('https://cdn.example/missing.mp4')).resolves.toBeUndefined()
    expect(createElement).toHaveBeenCalledWith('video')
  })
})
