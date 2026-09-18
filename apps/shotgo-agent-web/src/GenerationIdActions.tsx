import { useState } from 'react'
import type { GenerationArtifact, GenerationRef } from './agent-session.ts'
import { generationRefsFromText } from './agent-session.ts'

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="id-copy-chip"
      title={`复制${label}`}
      onClick={() => {
        void copyText(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_500)
        })
      }}
    >
      <span className="id-copy-chip__label">{label}</span>
      <code>{value}</code>
      <span className="id-copy-chip__action">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

function stateLabel(state: string | undefined): string | undefined {
  if (state === undefined) return undefined
  if (state === 'queued') return '排队中'
  if (state === 'processing') return '生成中'
  if (state === 'completed' || state === 'success') return '已完成'
  if (state === 'failed' || state === 'cancelled') return '失败'
  return state
}

/** Fallback when no artifact cards are rendered (e.g. text-only ID recovery). */
export function GenerationIdActions({
  text,
  artifacts,
  generationRefs,
}: {
  text: string
  artifacts?: GenerationArtifact[]
  generationRefs?: GenerationRef[]
}) {
  const refs = generationRefs && generationRefs.length > 0
    ? generationRefs
    : generationRefsFromText(text)
  if (!refs || refs.length === 0) {
    if (!artifacts || artifacts.length === 0) return null
    return (
      <div className="id-copy-bar" aria-label="任务标识">
        {artifacts.map(item => (
          <CopyChip key={item.id} label="产物 ID" value={item.id} />
        ))}
      </div>
    )
  }
  return (
    <div className="id-copy-bar" aria-label="任务标识">
      {refs.map(item => (
        <div className="id-copy-group" key={`${item.generationId}:${item.clientRequestId}`}>
          <CopyChip label="任务 ID" value={item.generationId} />
          <CopyChip label="请求 ID" value={item.clientRequestId} />
          {stateLabel(item.state) ? <span className="id-copy-state">{stateLabel(item.state)}</span> : null}
        </div>
      ))}
    </div>
  )
}
