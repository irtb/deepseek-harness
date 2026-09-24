import {
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
} from './gateway-protocol.ts'
import { gatewayStatusMessage } from './network-error.ts'

const RETRYABLE_GATEWAY_STATUSES = new Set([500, 502, 503, 504])

/** Structured stream failure used to distinguish transient transport faults from permanent recovery refusal. */
export class GatewayStreamError extends Error {
  readonly retryable: boolean

  /**
   * @param status - HTTP status returned by the Gateway stream endpoint.
   * @param code - Optional structured Gateway error code.
   */
  constructor(readonly status: number, readonly code?: string) {
    super(gatewayStatusMessage(status, code, `Gateway stream unavailable (${status})`))
    this.name = 'GatewayStreamError'
    this.retryable = RETRYABLE_GATEWAY_STATUSES.has(status)
  }
}

/**
 * Test whether reconnecting the same stream cannot recover the failure.
 * @param cause - Failure raised while opening or consuming a Gateway stream.
 * @returns Whether the Gateway returned a non-retryable structured response.
 */
export function isPermanentGatewayStreamError(cause: unknown): cause is GatewayStreamError {
  return cause instanceof GatewayStreamError && !cause.retryable
}

export interface GatewayExceptionStreamOptions {
  gatewayBaseUrl: string
  sessionId: string
  capabilityGrant: string
  afterCursor?: number
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  onEvent: (event: unknown) => void
  onCursor: (cursor: number) => void
  stopWhen?: (event: unknown) => boolean
}

/** Reads authenticated Gateway SSE without putting the Capability Grant in a URL. */
export async function streamGatewayExceptionDecisions(options: GatewayExceptionStreamOptions): Promise<void> {
  const fetch = options.fetch ?? globalThis.fetch
  const url = new URL(
    `/api/agent/v1/sessions/${encodeURIComponent(options.sessionId)}/events`,
    options.gatewayBaseUrl,
  )
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${options.capabilityGrant}`,
      [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      ...(options.afterCursor === undefined ? {} : { 'Last-Event-ID': String(options.afterCursor) }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (!response.ok || response.body === null) {
    const body = await response.json().catch(() => null) as { code?: unknown } | null
    const code = typeof body?.code === 'string' ? body.code : undefined
    throw new GatewayStreamError(response.status, code)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    let split = buffer.indexOf('\n\n')
    while (split >= 0) {
      const frame = buffer.slice(0, split).replaceAll('\r', '')
      buffer = buffer.slice(split + 2)
      const id = frame.split('\n').find(line => line.startsWith('id:'))?.slice(3).trim()
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (id !== undefined && /^\d+$/.test(id)) options.onCursor(Number(id))
      if (data.length > 0) {
        try {
          const event = JSON.parse(data) as unknown
          options.onEvent(event)
          if (options.stopWhen?.(event) === true) {
            await reader.cancel()
            return
          }
        } catch {
          // A malformed frame is ignored; the cursor is retained so reconnect does not loop on it.
        }
      }
      split = buffer.indexOf('\n\n')
    }
  }
}
