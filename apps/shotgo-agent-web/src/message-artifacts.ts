import type { AgentMessage, AgentMode, GenerationArtifact, GenerationRef } from './agent-session.ts'
import { generationRefsFromText } from './agent-session.ts'
import { artifactBelongsToGeneration } from './generation-lifecycle.ts'

function placeholderFromRef(ref: GenerationRef, mode: AgentMode): GenerationArtifact {
  const state = ref.state
  const status: GenerationArtifact['status'] =
    state === 'failed' || state === 'cancelled' || state === 'not_found'
      ? 'failed'
      : state === 'queued'
        ? 'queued'
        : 'processing'
  return {
    id: ref.generationId,
    mediaType: mode,
    status,
    ...(state === 'reconciling' ? { error: '核对中' } : {}),
    ...(state === 'not_found' ? { error: '未创建' } : {}),
  }
}

export function resolvedGenerationRefs(message: AgentMessage): GenerationRef[] {
  const fromEvent = message.generationRefs ?? []
  const fromText = generationRefsFromText(message.text) ?? []
  if (fromEvent.length === 0) return fromText
  if (fromText.length === 0) return fromEvent
  const unique = new Map<string, GenerationRef>()
  for (const item of fromEvent) unique.set(item.generationId, item)
  for (const item of fromText) {
    const current = unique.get(item.generationId)
    unique.set(item.generationId, current ? { ...item, ...current } : item)
  }
  return [...unique.values()]
}

/** Prefer real artifacts; fill missing generationRefs with progress placeholders. */
export function artifactsForMessage(message: AgentMessage, mode: AgentMode): GenerationArtifact[] {
  const artifacts = message.artifacts ?? []
  const refs = resolvedGenerationRefs(message)
  if (refs.length === 0) return artifacts

  const covered = new Set<string>()
  for (const artifact of artifacts) {
    for (const ref of refs) {
      if (artifactBelongsToGeneration(artifact.id, ref.generationId)) covered.add(ref.generationId)
    }
  }

  const placeholders = refs
    .filter(ref => !covered.has(ref.generationId))
    .map(ref => placeholderFromRef(ref, mode))

  return [...artifacts, ...placeholders]
}

export function generationIdFromArtifactId(artifactId: string): string {
  const split = artifactId.indexOf(':')
  return split === -1 ? artifactId : artifactId.slice(0, split)
}

export function statusLabel(status: GenerationArtifact['status'], error?: string): string {
  if (error === '核对中') return '核对中'
  if (error === '未创建') return '未创建'
  if (status === 'queued') return '排队中'
  if (status === 'processing') return '生成中'
  if (status === 'succeeded') return '已完成'
  return '失败'
}
