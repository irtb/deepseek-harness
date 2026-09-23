const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|webp)(\?|#|$)/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export function isLikelyImageUrl(url: string | undefined): boolean {
  if (url === undefined || url === '') return false
  if (url.startsWith('data:image/')) return true
  return IMAGE_EXT.test(url) && !VIDEO_EXT.test(url)
}

export function resolvePosterSrc(input: {
  url?: string | undefined
  thumbnailUrl?: string | undefined
}): string | undefined {
  const thumb = input.thumbnailUrl
  if (!isLikelyImageUrl(thumb)) return undefined
  if (input.url !== undefined && thumb === input.url) return undefined
  return thumb
}

export function formatDurationLabel(seconds: number | undefined): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole}s`
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Poster plus duration from one in-memory video element. Omitted fields mean "not available". */
export type CapturedVideoFrame = {
  poster?: string
  durationSec?: number
}

const MEDIA_WAIT_MS = 12_000

function wait(video: HTMLVideoElement, type: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    let cleaned = false
    const state: { timer?: ReturnType<typeof setTimeout> } = {}
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      if (state.timer !== undefined) clearTimeout(state.timer)
      video.removeEventListener(type, onOk)
      video.removeEventListener('error', onErr)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new DOMException('aborted', 'AbortError'))
    }
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error('media error'))
    }
    const onTimeout = () => {
      cleanup()
      reject(new Error('media timeout'))
    }
    state.timer = setTimeout(onTimeout, MEDIA_WAIT_MS)
    video.addEventListener(type, onOk, { once: true })
    video.addEventListener('error', onErr, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function captureVideoFrame(
  videoUrl: string,
  options?: { signal?: AbortSignal },
): Promise<CapturedVideoFrame | undefined> {
  if (typeof document === 'undefined') return undefined
  let video: HTMLVideoElement | undefined
  try {
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = videoUrl
    video.load()
    if (typeof video.readyState !== 'number') return undefined
    await wait(video, 'loadedmetadata', options?.signal)
    const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined
    const duration = durationSec ?? 0
    const targets = [0.1, duration > 0 ? Math.min(duration * 0.1, Math.max(duration - 0.05, 0)) : 0.1]
    let poster: string | undefined
    for (const t of targets) {
      try {
        video.currentTime = Math.max(0, t)
        await wait(video, 'seeked', options?.signal)
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 360
        if (canvas.width < 2 || canvas.height < 2) continue
        const ctx = canvas.getContext('2d')
        if (ctx === null) continue
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const data = canvas.toDataURL('image/jpeg', 0.82)
        if (data.startsWith('data:image/')) {
          poster = data
          break
        }
      } catch {
        // try next target
      }
    }
    if (poster === undefined && durationSec === undefined) return undefined
    const captured: CapturedVideoFrame = {}
    if (poster !== undefined) captured.poster = poster
    if (durationSec !== undefined) captured.durationSec = durationSec
    return captured
  } catch {
    return undefined
  } finally {
    if (video !== undefined && typeof video.removeAttribute === 'function') {
      video.removeAttribute('src')
      video.load()
    }
  }
}
