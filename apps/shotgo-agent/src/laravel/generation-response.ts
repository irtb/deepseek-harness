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
    && (item.failureCode === undefined || typeof item.failureCode === 'string')
}
