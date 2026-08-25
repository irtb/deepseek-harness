import type { AgentMode } from './laravel-v1.ts'

export const SHOTGO_GATEWAY_PROTOCOL_VERSION = '2026-08-24.1' as const
export const SHOTGO_GATEWAY_PROTOCOL_HEADER = 'X-ShotGo-Gateway-Protocol-Version' as const

export interface GatewayMessageRequest {
  clientRequestId: string
  message: {
    type: 'text'
    text: string
  }
}

export interface GatewayRunAccepted {
  protocolVersion: typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  sessionId: string
  runId: string
  streamUrl: string
}

export interface GatewayStreamEvent {
  protocolVersion: typeof SHOTGO_GATEWAY_PROTOCOL_VERSION
  cursor: number
  sessionId: string
  runId: string
  agentMode: AgentMode
  occurredAt: string
  type: 'run.accepted' | 'session.event' | 'run.completed' | 'run.cancelled' | 'run.failed'
  payload: Record<string, unknown>
}
