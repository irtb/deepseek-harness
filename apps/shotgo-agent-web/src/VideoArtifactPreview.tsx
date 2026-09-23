import { useEffect, useRef, useState } from 'react'
import { captureVideoFrame, formatDurationLabel, resolvePosterSrc } from './video-poster.ts'

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** jsdom's HTMLMediaElement.play() may return undefined instead of a Promise. */
function safePlay(video: HTMLVideoElement): Promise<void> {
  try {
    const result = video.play() as Promise<void> | undefined
    if (result != null && typeof result.then === 'function') return result
  } catch {
    // ignore autoplay / media errors
  }
  return Promise.resolve()
}

export function VideoArtifactPreview({
  url,
  thumbnailUrl,
}: {
  url: string
  thumbnailUrl?: string | undefined
}): JSX.Element {
  const [mode, setMode] = useState<'cover' | 'playing'>('cover')
  const [poster, setPoster] = useState<string | undefined>(() =>
    resolvePosterSrc({ url, thumbnailUrl }),
  )
  const [durationSec, setDurationSec] = useState<number | undefined>()
  const [current, setCurrent] = useState(0)
  const [muted, setMuted] = useState(true)
  const [paused, setPaused] = useState(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const resolved = resolvePosterSrc({ url, thumbnailUrl })
    setPoster(resolved)
    setDurationSec(undefined)
    const ac = new AbortController()

    // Still thumbnail: one metadata probe for the badge. No thumbnail: one capture
    // element returns both the poster and duration (no second preload of the same URL).
    if (resolved === undefined) {
      void captureVideoFrame(url, { signal: ac.signal })
        .then((frame) => {
          if (ac.signal.aborted || frame === undefined) return
          if (frame.poster !== undefined) setPoster(frame.poster)
          if (frame.durationSec !== undefined) setDurationSec(frame.durationSec)
        })
        .catch(() => {
          // Silent capture failure — never block playback.
        })
      return () => {
        ac.abort()
      }
    }

    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.muted = true
    probe.playsInline = true
    const onMeta = () => {
      if (ac.signal.aborted) return
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setDurationSec(probe.duration)
      }
    }
    probe.addEventListener('loadedmetadata', onMeta)
    probe.src = url
    return () => {
      ac.abort()
      probe.removeEventListener('loadedmetadata', onMeta)
      probe.removeAttribute('src')
      probe.load()
    }
  }, [url, thumbnailUrl])

  useEffect(() => {
    if (mode !== 'playing') return
    const video = videoRef.current
    if (video === null) return
    void safePlay(video).then(() => {
      setPaused(false)
    }).catch(() => {
      setPaused(true)
    })
  }, [mode])

  const durationLabel = formatDurationLabel(durationSec)
  const total = typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : 0
  const beginPlayback = () => {
    setMode('playing')
    setPaused(false)
    setCurrent(0)
  }

  if (mode === 'cover') {
    return (
      <div className="video-preview" onClick={beginPlayback}>
        {poster !== undefined ? (
          <img className="video-preview__media" src={poster} alt="" draggable={false} />
        ) : (
          <div className="video-preview__media video-preview__placeholder" aria-hidden="true" />
        )}
        <button
          type="button"
          className="video-preview__play"
          aria-label="播放视频"
          onClick={(event) => {
            event.stopPropagation()
            beginPlayback()
          }}
        >
          <span aria-hidden="true">▶</span>
        </button>
        {durationLabel !== undefined ? (
          <span className="video-preview__badge">{durationLabel}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`video-preview video-preview--playing${paused ? ' is-paused' : ''}`}>
      <video
        ref={videoRef}
        className="video-preview__media"
        src={url}
        playsInline
        muted={muted}
        poster={poster}
        onClick={() => {
          const video = videoRef.current
          if (video === null) return
          if (video.paused) {
            void safePlay(video).then(() => setPaused(false)).catch(() => setPaused(true))
          } else {
            video.pause()
            setPaused(true)
          }
        }}
        onTimeUpdate={() => {
          const video = videoRef.current
          if (video === null) return
          setCurrent(video.currentTime)
        }}
        onLoadedMetadata={() => {
          const video = videoRef.current
          if (video === null) return
          if (Number.isFinite(video.duration) && video.duration > 0) {
            setDurationSec(video.duration)
          }
        }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => {
          setMode('cover')
          setPaused(true)
          setCurrent(0)
        }}
      />
      <div className="video-preview__bar" onClick={event => event.stopPropagation()}>
        <button
          type="button"
          className="video-preview__bar-btn"
          aria-label={paused ? '播放' : '暂停'}
          onClick={() => {
            const video = videoRef.current
            if (video === null) return
            if (video.paused) {
              void safePlay(video).then(() => setPaused(false)).catch(() => setPaused(true))
            } else {
              video.pause()
              setPaused(true)
            }
          }}
        >
          <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
        </button>
        <input
          className="video-preview__range"
          type="range"
          min={0}
          max={total > 0 ? total : 1}
          step={0.05}
          value={Math.min(current, total > 0 ? total : current)}
          aria-label="播放进度"
          onChange={(event) => {
            const next = Number(event.target.value)
            const video = videoRef.current
            setCurrent(next)
            if (video !== null && Number.isFinite(next)) {
              video.currentTime = next
            }
          }}
        />
        <span className="video-preview__time">
          {formatClock(current)}
          {total > 0 ? ` / ${formatClock(total)}` : ''}
        </span>
        <button
          type="button"
          className="video-preview__bar-btn"
          aria-label={muted ? '取消静音' : '静音'}
          aria-pressed={muted}
          onClick={() => setMuted(value => !value)}
        >
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
        </button>
      </div>
    </div>
  )
}
