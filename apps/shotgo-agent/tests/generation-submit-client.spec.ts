import { describe, expect, it } from 'vitest'
import { LaravelGenerationSubmitClient } from '../src/laravel/generation-submit-client.ts'

const request = {
  capabilityGrant: 'grant-token',
  context: {
    sessionId: 'session-1',
    runId: 'run-1',
    actionId: 'action-1',
    clientRequestId: 'generation-request-1',
  },
  quoteId: 'opaque-quote',
  quoteVersion: 1 as const,
}

describe('LaravelGenerationSubmitClient', () => {
  it('sends Grant bearer and matching idempotency key, then validates the response', async () => {
    let captured: RequestInit | undefined
    const client = new LaravelGenerationSubmitClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async (_url, init) => {
        captured = init
        return new Response(JSON.stringify({
          protocolVersion: '2026-08-25.1',
          generationId: '42',
          clientRequestId: 'generation-request-1',
          operationId: 'generation-42',
          state: 'queued',
          stage: 'queued',
          credits: 18,
          userBalance: 82,
          replayed: false,
          createdAt: '2026-08-25T20:00:00+08:00',
          updatedAt: '2026-08-25T20:00:00+08:00',
        }), { status: 202, headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' } })
      },
    })

    await expect(client.submit(request)).resolves.toMatchObject({ generationId: '42', credits: 18 })
    const headers = new Headers(captured?.headers)
    expect(headers.get('Authorization')).toBe('Bearer grant-token')
    expect(headers.get('Idempotency-Key')).toBe('generation-request-1')
    expect(JSON.parse(captured?.body as string)).toEqual({
      context: request.context,
      quoteId: 'opaque-quote',
      quoteVersion: 1,
    })
  })

  it('fails closed on protocol errors', async () => {
    const client = new LaravelGenerationSubmitClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async () => new Response('{}', { status: 202 }),
    })
    await expect(client.submit(request)).rejects.toThrow('GENERATION_SUBMIT_PROTOCOL_INVALID')
  })
})
