import type { AgentMode } from './laravel-v1.ts'

export {
  SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS,
  isShotGoGatewayProtocolVersion,
  type ShotGoGatewayProtocolVersion,
} from './gateway-protocol.ts'

export interface GatewayReferenceAsset {
  mediaLibraryItemId: number
}

export type GatewayImageGenerationParameters = Partial<{
  qualityId: string
  resolutionId: string
  aspectRatioId: string
  referenceAssets: GatewayReferenceAsset[]
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
  protocolVersion: ShotGoGatewayProtocolVersion
  sessionId: string
  runId: string
  streamEpoch: string
  streamUrl: string
}

export interface GatewayApprovalResponse {
  outcome: 'allowed-once' | 'rejected'
}

export interface GatewayStreamEvent {
  protocolVersion: typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  cursor: number
  streamEpoch: string
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
