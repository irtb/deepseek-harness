import {
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
} from './gateway-protocol.ts'

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
  if (!response.ok || response.body === null) throw new Error(`Gateway stream unavailable (${response.status})`)

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
