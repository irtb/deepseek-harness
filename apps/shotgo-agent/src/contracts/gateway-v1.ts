import type { AgentMode } from './laravel-v1.ts'

export const SHOTGO_GATEWAY_PROTOCOL_VERSION = '2026-08-26.1' as const
export const SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION = '2026-08-25.1' as const
export const SHOTGO_GATEWAY_PROTOCOL_HEADER = 'X-ShotGo-Gateway-Protocol-Version' as const
export type ShotGoGatewayProtocolVersion =
  | typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  | typeof SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION

export type GatewayImageGenerationParameters = Partial<{
  qualityId: string
  resolutionId: string
  aspectRatioId: string
  multipleId: string
}>

export type GatewayVideoGenerationParameters = Partial<{
  resolutionId: string
  aspectRatioId: string
  duration: number
  fps: number
  audio: boolean
  operationType: string
}>

interface GatewayGenerationContextBase {
  schemaVersion: 1
  modelId: string
}

export type GatewayGenerationContext = GatewayGenerationContextBase & (
  | { kind: 'image'; parameters: GatewayImageGenerationParameters }
  | { kind: 'video'; parameters: GatewayVideoGenerationParameters }
)

export interface GatewayMessageRequest {
  clientRequestId: string
  message: {
    type: 'text'
    text: string
  }
  generationContext?: GatewayGenerationContext
}

export interface GatewayRunAccepted {
  protocolVersion: typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  sessionId: string
  runId: string
  streamUrl: string
}

export interface GatewayApprovalResponse {
  outcome: 'allowed-once' | 'rejected'
}

export interface GatewayStreamEvent {
  protocolVersion: typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  cursor: number
  sessionId: string
  runId: string
  agentMode: AgentMode
  occurredAt: string
  type:
    | 'run.accepted'
    | 'session.event'
    | 'approval.requested'
    | 'approval.resolved'
    | 'run.completed'
    | 'run.cancelled'
    | 'run.failed'
  payload: Record<string, unknown>
}
