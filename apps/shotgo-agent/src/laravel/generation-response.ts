import {
  SHOTGO_PROTOCOL_VERSION,
  type GenerationResponse,
  type GenerationState,
} from '../contracts/laravel-v1.ts'

const STATES: readonly GenerationState[] = [
  'draft', 'creating', 'queued', 'processing', 'completed', 'failed', 'cancelled',
]

export function isGenerationResponse(value: unknown): value is GenerationResponse {
  if (value === null || typeof value !== 'object') return false
  const item = value as Partial<GenerationResponse>
  const rawAssets = (value as Record<string, unknown>).assets
  return item.protocolVersion === SHOTGO_PROTOCOL_VERSION
    && typeof item.generationId === 'string'
    && typeof item.clientRequestId === 'string'
    && typeof item.operationId === 'string'
    && typeof item.state === 'string'
    && STATES.includes(item.state)
    && typeof item.stage === 'string'
    && Number.isSafeInteger(item.credits)
    && Number.isSafeInteger(item.userBalance)
    && typeof item.replayed === 'boolean'
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && (rawAssets === undefined || (
      Array.isArray(rawAssets)
      && rawAssets.every((asset) => {
        if (asset === null || typeof asset !== 'object') return false
        const candidate = asset as unknown as Record<string, unknown>
        if (Object.keys(candidate).some(key => !['assetId', 'kind', 'url', 'sizeBytes'].includes(key))) return false
        if (typeof candidate.assetId !== 'string' || candidate.assetId.length === 0) return false
        if (!['image', 'video', 'audio'].includes(String(candidate.kind))) return false
        if (typeof candidate.url !== 'string') return false
        try {
          const url = new URL(candidate.url)
          if (!['http:', 'https:'].includes(url.protocol)) return false
        } catch {
          return false
        }
        return Number.isSafeInteger(candidate.sizeBytes) && Number(candidate.sizeBytes) >= 0
      })
    ))
    && (item.failureCode === undefined || typeof item.failureCode === 'string')
}
