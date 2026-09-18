import type { GenerationArtifact } from './agent-session.ts'
import { createGrant } from './gateway-client.ts'

function apiBase(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

/** Distinguishable when by-id / by-client-request returns 404 (intent never persisted). */
export class GenerationLifecycleNotFoundError extends Error {
  constructor(readonly clientRequestId?: string) {
    super('GENERATION_NOT_FOUND')
    this.name = 'GenerationLifecycleNotFoundError'
  }
}

export interface GenerationLifecycleStatus {
  generationId: string
  clientRequestId: string
  state: string
  stage: string
  assets: GenerationArtifact[]
}

export function artifactBelongsToGeneration(artifactId: string, generationId: string): boolean {
  return artifactId === generationId || artifactId.startsWith(`${generationId}:`)
}

function mapAssets(value: unknown, generationId: string): GenerationArtifact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): GenerationArtifact[] => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url : undefined
    const kind = record.kind === 'video' ? 'video' : 'image'
    const assetId = typeof record.assetId === 'string' ? record.assetId : String(index)
    return [{
      id: `${generationId}:${assetId}`,
      mediaType: kind,
      status: 'succeeded',
      ...(url === undefined ? {} : { url, thumbnailUrl: url }),
    }]
  })
}

function mapPending(generationId: string, state: string): GenerationArtifact[] {
  const status = state === 'queued' ? 'queued' : state === 'failed' || state === 'cancelled' ? 'failed' : 'processing'
  return [{ id: generationId, mediaType: 'image', status }]
}

function isNumericGenerationId(value: string): boolean {
  return /^\d+$/.test(value)
}

/** Read authoritative generation status with a session-scoped Agent grant. */
export async function fetchGenerationLifecycle(input: {
  token: string
  sessionId: string
  mode: 'image' | 'video'
  generationId: string
  clientRequestId?: string
  spaceId?: string
  projectId?: string
  grantToken?: string
  signal?: AbortSignal
}): Promise<GenerationLifecycleStatus> {
  const grantToken =
    input.grantToken ??
    (
      await createGrant({
        token: input.token,
        sessionId: input.sessionId,
        mode: input.mode,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
    ).grantToken

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${grantToken}`,
  }
  const signal = input.signal === undefined ? {} : { signal: input.signal }

  const byIdUrl = isNumericGenerationId(input.generationId)
    ? `${apiBase()}/api/agent/v1/generations/${encodeURIComponent(input.generationId)}`
    : undefined
  const byClientUrl =
    input.clientRequestId !== undefined && input.clientRequestId.length > 0
      ? `${apiBase()}/api/agent/v1/generations/by-client-request/${encodeURIComponent(input.clientRequestId)}`
      : input.generationId.startsWith('gen-')
        ? `${apiBase()}/api/agent/v1/generations/by-client-request/${encodeURIComponent(input.generationId)}`
        : undefined

  let response: Response | undefined
  if (byIdUrl !== undefined) {
    response = await fetch(byIdUrl, { headers, ...signal })
  }
  if ((response === undefined || response.status === 404) && byClientUrl !== undefined) {
    response = await fetch(byClientUrl, { headers, ...signal })
  }
  if (response === undefined) {
    throw new Error('缺少可查询的 generationId / clientRequestId')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string; message?: string; code?: string } | null
    const code = body?.code ?? ''
    if (response.status === 404 || code === 'GENERATION_NOT_FOUND') {
      throw new GenerationLifecycleNotFoundError(
        input.clientRequestId ?? (input.generationId.startsWith('gen-') ? input.generationId : undefined),
      )
    }
    throw new Error(body?.detail ?? body?.message ?? body?.code ?? '读取生成状态失败')
  }
  const payload = (await response.json()) as {
    generationId?: string
    clientRequestId?: string
    state?: string
    stage?: string
    assets?: unknown
  }
  const generationId = typeof payload.generationId === 'string' ? payload.generationId : input.generationId
  const state = typeof payload.state === 'string' ? payload.state : 'processing'
  const assets = state === 'completed'
    ? mapAssets(payload.assets, generationId)
    : mapPending(generationId, state)
  return {
    generationId,
    clientRequestId: typeof payload.clientRequestId === 'string' ? payload.clientRequestId : '',
    state,
    stage: typeof payload.stage === 'string' ? payload.stage : state,
    assets,
  }
}

export function needsLifecyclePoll(artifacts: GenerationArtifact[] | undefined): boolean {
  if (artifacts === undefined || artifacts.length === 0) return true
  return artifacts.some(item => item.status === 'queued' || item.status === 'processing' || (item.status === 'succeeded' && !item.url))
}

/** True when this generation already has a renderable terminal card. */
export function isGenerationRenderSettled(
  artifacts: GenerationArtifact[] | undefined,
  generationId: string,
  state: string | undefined,
): boolean {
  if (state === 'failed' || state === 'cancelled' || state === 'not_found') return true
  if (state === 'reconciling') return false
  const list = artifacts ?? []
  const related = list.filter(item => artifactBelongsToGeneration(item.id, generationId))
  const renderable = (items: GenerationArtifact[]) =>
    items.some(item => item.status === 'succeeded' && typeof item.url === 'string' && item.url.length > 0)

  if (state === 'completed') {
    if (renderable(related)) return true
    // First poll bug wrote bare assetId (e.g. "700") instead of "703:700".
    if (renderable(list) && !related.some(item => item.status === 'queued' || item.status === 'processing')) {
      return true
    }
    return false
  }

  if (related.length === 0) return false
  return !needsLifecyclePoll(related)
}
