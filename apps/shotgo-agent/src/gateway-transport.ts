import type { GatewayStreamEvent } from './contracts/gateway-v1.ts'

export interface GatewaySessionSubmit {
  capabilityGrant: string
  sessionId: string
  clientRequestId: string
  text: string
  signal?: AbortSignal
}

export interface GatewaySessionAccess {
  capabilityGrant: string
  sessionId: string
  afterCursor: number
  signal?: AbortSignal
}

export interface GatewaySessionCancel {
  capabilityGrant: string
  sessionId: string
  runId: string
  signal?: AbortSignal
}

/** Host adapter used by the HTTP Gateway without importing a Harness implementation. */
export interface GatewaySessionService {
  submit(input: GatewaySessionSubmit): Promise<{ runId: string }>
  events(input: GatewaySessionAccess): Promise<AsyncIterable<GatewayStreamEvent>>
  cancel(input: GatewaySessionCancel): Promise<void>
  dispose(): Promise<void>
}
