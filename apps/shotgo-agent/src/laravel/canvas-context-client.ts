import {
  SHOTGO_PROTOCOL_HEADER,
  isSupportedShotGoProtocolVersion,
  type CanvasContextResponse,
} from '../contracts/laravel-v1.ts'

export class LaravelCanvasContextClient {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch

  constructor(options: { baseURL: string; fetch?: typeof globalThis.fetch }) {
    this.baseURL = options.baseURL.replace(/\/$/, '')
    if (!/^https:\/\//.test(this.baseURL) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/.test(this.baseURL)) {
      throw new Error('Canvas context client requires HTTPS outside loopback')
    }
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async read(input: { capabilityGrant: string; sessionId: string; signal?: AbortSignal }): Promise<CanvasContextResponse> {
    const response = await this.fetch(`${this.baseURL}/api/agent/v1/canvas-context`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.capabilityGrant}`,
        'Content-Type': 'application/json',
        'X-ShotGo-Protocol-Version': '2026-08-26.1',
      },
      body: JSON.stringify({ sessionId: input.sessionId }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (!response.ok) throw new Error(`CANVAS_CONTEXT_READ_FAILED_${response.status}`)
    const value: unknown = await response.json()
    const version = response.headers.get(SHOTGO_PROTOCOL_HEADER)
    if (!isSupportedShotGoProtocolVersion(version) || !isCanvasContext(value)) {
      throw new Error('INVALID_CANVAS_CONTEXT_RESPONSE')
    }
    return value
  }
}

function isCanvasContext(value: unknown): value is CanvasContextResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return isSupportedShotGoProtocolVersion(input.protocolVersion)
    && input.snapshotVersion === 1
    && typeof input.sessionId === 'string'
    && typeof input.spaceId === 'string'
    && typeof input.projectId === 'string'
    && typeof input.projectName === 'string'
    && typeof input.revision === 'string'
    && Array.isArray(input.nodes)
    && input.nodes.length <= 80
    && Array.isArray(input.connections)
    && input.connections.length <= 120
    && Array.isArray(input.locks)
    && Array.isArray(input.availableCapabilities)
}
