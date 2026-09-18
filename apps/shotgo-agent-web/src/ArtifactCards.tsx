import { useEffect, useRef } from 'react'
import type { GenerationArtifact, GenerationRef } from './agent-session.ts'
import { generationIdFromArtifactId, statusLabel } from './message-artifacts.ts'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function CopyChip({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      className="id-copy-chip"
      title={`复制${label}`}
      onClick={() => {
        void copyText(value)
      }}
    >
      <span className="id-copy-chip__label">{label}</span>
      <code>{value}</code>
      <span className="id-copy-chip__action">复制</span>
    </button>
  )
}

function refForArtifact(
  artifact: GenerationArtifact,
  refs: GenerationRef[] | undefined,
): GenerationRef | undefined {
  const generationId = generationIdFromArtifactId(artifact.id)
  return refs?.find(item => item.generationId === generationId)
}

export function ArtifactCards({
  artifacts,
  generationRefs,
  scrollOnReveal = true,
}: {
  artifacts: GenerationArtifact[]
  generationRefs?: GenerationRef[]
  scrollOnReveal?: boolean
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const knownReady = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!scrollOnReveal) return
    const readyIds = artifacts
      .filter(item => item.status === 'succeeded' && typeof item.url === 'string' && item.url.length > 0)
      .map(item => item.id)

    if (knownReady.current === null) {
      knownReady.current = new Set(readyIds)
      return
    }

    for (const id of readyIds) {
      if (knownReady.current.has(id)) continue
      knownReady.current.add(id)
      const node = cardRefs.current.get(id)
      node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      // Keep the media above the composer: nudge scroll container to end if near bottom.
      const scroller = document.getElementById('agent-scroll-content')
      if (scroller !== null) {
        const room = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        if (room < 160) scroller.scrollTop = scroller.scrollHeight
      }
    }
  }, [artifacts, scrollOnReveal])

  if (artifacts.length === 0) return null

  return (
    <div className="artifact-grid">
      {artifacts.map((item) => {
        const ref = refForArtifact(item, generationRefs)
        const generationId = ref?.generationId ?? generationIdFromArtifactId(item.id)
        const ready = item.status === 'succeeded' && typeof item.url === 'string' && item.url.length > 0
        const tone =
          item.status === 'processing' || item.status === 'queued'
            ? ' is-pending'
            : item.status === 'failed'
              ? ' is-failed'
              : ready
                ? ' is-ready'
                : ''
        return (
          <article
            className={`artifact-card${tone}`}
            key={item.id}
            ref={(node) => {
              if (node) cardRefs.current.set(item.id, node)
              else cardRefs.current.delete(item.id)
            }}
            data-generation-id={generationId}
          >
            {ready ? (
              item.mediaType === 'image' ? (
                <a className="artifact-media" href={item.url} target="_blank" rel="noopener noreferrer" title="在新标签打开成品">
                  <img src={item.thumbnailUrl ?? item.url} alt="生成结果" />
                </a>
              ) : (
                <div className="artifact-media">
                  <video src={item.url} poster={item.thumbnailUrl} controls playsInline />
                </div>
              )
            ) : (
              <div className="artifact-state" aria-live="polite">
                <span className="artifact-state__pulse" aria-hidden="true" />
                <strong>{statusLabel(item.status, item.error)}</strong>
                <em>任务 {generationId}</em>
              </div>
            )}
            <div className="artifact-meta">
              <span>
                {item.mediaType === 'image' ? '图片' : '视频'} · {statusLabel(item.status, item.error)}
              </span>
              {ready ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  打开成品
                </a>
              ) : null}
            </div>
            <div className="artifact-card__ids">
              <CopyChip label="任务 ID" value={generationId} />
              {ref?.clientRequestId && !ref.clientRequestId.startsWith('pending-') ? (
                <CopyChip label="请求 ID" value={ref.clientRequestId} />
              ) : null}
            </div>
            {item.error ? <p className="artifact-card__error">{item.error}</p> : null}
          </article>
        )
      })}
    </div>
  )
}
