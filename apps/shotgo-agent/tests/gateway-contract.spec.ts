import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { SHOTGO_GATEWAY_PROTOCOL_VERSION } from '../src/contracts/gateway-v1.ts'

interface OpenApiOperation {
  security?: Array<Record<string, unknown[]>>
  responses?: Record<string, unknown>
}

interface OpenApiDocument {
  info: { version: string }
  paths: Record<string, Record<string, OpenApiOperation>>
}

describe('Agent Gateway protocol', () => {
  it('keeps Session submission, SSE replay, and cancellation on capability grants', async () => {
    const document = JSON.parse(await readFile(
      new URL('../contracts/gateway-v1.openapi.json', import.meta.url),
      'utf8',
    )) as OpenApiDocument
    expect(document.info.version).toBe(SHOTGO_GATEWAY_PROTOCOL_VERSION)

    const operations = [
      document.paths['/api/agent/v1/sessions/{sessionId}/messages']?.post,
      document.paths['/api/agent/v1/sessions/{sessionId}/events']?.get,
      document.paths['/api/agent/v1/sessions/{sessionId}/runs/{runId}']?.delete,
    ]
    expect(operations).not.toContain(undefined)
    for (const operation of operations) {
      expect(operation?.security).toContainEqual({ capabilityGrant: [] })
    }

    const serialized = JSON.stringify(document)
    expect(serialized).toContain('Last-Event-ID')
    expect(serialized).toContain('Idempotency-Key')
    expect(serialized).not.toMatch(/apiKey|ARK_API_KEY|serviceToken/)
  })
})
