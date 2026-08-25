import { describe, expect, it } from 'vitest'
import { LaravelGenerationLifecycleClient } from '../src/laravel/generation-lifecycle-client.ts'

const generation = {
  protocolVersion: '2026-08-25.1',
  generationId: '42',
  clientRequestId: 'generation-request',
  operationId: 'generation-42',
  state: 'processing',
  stage: 'processing',
  credits: 18,
  userBalance: 82,
  replayed: false,
  createdAt: '2026-08-25T20:00:00+08:00',
  updatedAt: '2026-08-25T20:01:00+08:00',
  assets: [{
    assetId: 'asset-42',
    kind: 'video',
    url: 'https://cdn.shotgo.cn/resource/canvas/2/result.mp4',
    sizeBytes: 12345,
  }],
} as const

describe('Laravel generation lifecycle client', () => {
  it('binds status and cancellation to the current Grant and deterministic mutation context', async () => {
    const requests: Array<Record<string, unknown>> = []
    const client = new LaravelGenerationLifecycleClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers)
        requests.push({
          url: url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
          method: init?.method,
          authorization: headers.get('Authorization'),
          idempotencyKey: headers.get('Idempotency-Key'),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        })
        return new Response(JSON.stringify({
          ...generation,
          state: init?.method === 'POST' ? 'cancelled' : 'processing',
          stage: init?.method === 'POST' ? 'cancelled' : 'processing',
        }), {
          status: 200,
          headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
        })
      },
    })

    await expect(client.read({ capabilityGrant: 'grant-a', generationId: '42' }))
      .resolves.toMatchObject({ generationId: '42', state: 'processing', assets: generation.assets })
    await expect(client.cancel({
      capabilityGrant: 'grant-a',
      generationId: '42',
      context: {
        sessionId: 'session-a',
        runId: 'run-a',
        actionId: 'cancel-call',
        clientRequestId: 'cancel-request',
      },
    })).resolves.toMatchObject({ generationId: '42', state: 'cancelled' })

    expect(requests).toEqual([{
      url: 'https://api.shotgo.cn/api/agent/v1/generations/42',
      method: 'GET',
      authorization: 'Bearer grant-a',
      idempotencyKey: null,
      body: null,
    }, {
      url: 'https://api.shotgo.cn/api/agent/v1/generations/42/cancel',
      method: 'POST',
      authorization: 'Bearer grant-a',
      idempotencyKey: 'cancel-request',
      body: {
        context: {
          sessionId: 'session-a',
          runId: 'run-a',
          actionId: 'cancel-call',
          clientRequestId: 'cancel-request',
        },
      },
    }])
  })

  it('fails closed on a malformed Laravel response', async () => {
    const client = new LaravelGenerationLifecycleClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async () => new Response(JSON.stringify({ ...generation, userBalance: 1.5 }), {
        status: 200,
        headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
      }),
    })
    await expect(client.read({ capabilityGrant: 'grant-a', generationId: '42' }))
      .rejects.toThrow('GENERATION_STATUS_PROTOCOL_INVALID')
  })

  it('rejects private paths and unknown fields in asset results', async () => {
    const client = new LaravelGenerationLifecycleClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async () => new Response(JSON.stringify({
        ...generation,
        assets: [{ ...generation.assets[0], url: '/private/result.mp4', providerResponse: 'secret' }],
      }), {
        status: 200,
        headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
      }),
    })
    await expect(client.read({ capabilityGrant: 'grant-a', generationId: '42' }))
      .rejects.toThrow('GENERATION_STATUS_PROTOCOL_INVALID')
  })
})
