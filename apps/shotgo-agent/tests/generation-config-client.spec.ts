import { describe, expect, it, vi } from 'vitest'
import { LaravelGenerationConfigClient } from '../src/laravel/generation-config-client.ts'

const headers = {
  'Cache-Control': 'no-store, private',
  'X-ShotGo-Protocol-Version': '2026-08-25.1',
}

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: '2026-08-25.1',
    authorizationContextId: 'authctx-test',
    sessionId: 'session-1',
    kind: 'image',
    models: [{ id: 'image-v1', label: 'Image V1', credits: 18, vip: false }],
    defaults: { modelId: 'image-v1' },
    ...overrides,
  }
}

describe('Laravel generation config client', () => {
  it('reads one session-bound catalog with service auth and the opaque grant', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      JSON.stringify(config()),
      { status: 200, headers },
    ))
    const client = new LaravelGenerationConfigClient({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch,
    })

    await expect(client.read({
      capabilityGrant: 'opaque-grant',
      sessionId: 'session-1',
      kind: 'image',
    })).resolves.toMatchObject({
      sessionId: 'session-1',
      kind: 'image',
      models: [{ id: 'image-v1', label: 'Image V1' }],
    })

    const call = fetch.mock.calls[0]
    expect(call?.[0]).toBe('https://api.shotgo.cn/api/internal/agent/v1/generation/config')
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        grantToken: 'opaque-grant',
        sessionId: 'session-1',
        kind: 'image',
      }),
    })
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer service-token')
  })

  it('fails closed for mismatched scope, protocol, and cache policy', async () => {
    const cases = [
      new Response(JSON.stringify(config({ sessionId: 'other-session' })), { status: 200, headers }),
      new Response(JSON.stringify(config()), {
        status: 200,
        headers: { ...headers, 'X-ShotGo-Protocol-Version': 'old' },
      }),
      new Response(JSON.stringify(config()), {
        status: 200,
        headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
      }),
    ]

    for (const response of cases) {
      const client = new LaravelGenerationConfigClient({
        baseURL: 'https://api.shotgo.cn',
        serviceToken: 'service-token',
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
      })
      await expect(client.read({
        capabilityGrant: 'opaque-grant',
        sessionId: 'session-1',
        kind: 'image',
      })).rejects.toThrow()
    }
  })

  it('uses the latest in-memory grant when a session binding is refreshed', async () => {
    const grants: string[] = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
      const request: unknown = JSON.parse(init.body)
      if (request === null || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('expected JSON object request body')
      }
      const grantToken = (request as Record<string, unknown>).grantToken
      if (typeof grantToken !== 'string') throw new Error('expected grant token')
      grants.push(grantToken)
      return new Response(JSON.stringify(config()), { status: 200, headers })
    })
    const client = new LaravelGenerationConfigClient({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch,
    })
    const state = { grant: 'grant-a' }
    const reader = client.bind({ capabilityGrant: () => state.grant, sessionId: 'session-1' })

    await reader.read('image')
    state.grant = 'grant-b'
    await reader.read('image')

    expect(grants).toEqual(['grant-a', 'grant-b'])
  })
})
