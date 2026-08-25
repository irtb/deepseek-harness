import { describe, expect, it, vi } from 'vitest'
import { LaravelGenerationQuoteClient } from '../src/laravel/generation-quote-client.ts'

const headers = {
  'Cache-Control': 'no-store, private',
  'X-ShotGo-Protocol-Version': '2026-08-25.1',
}

function quote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: '2026-08-25.1',
    quoteId: 'opaque-encrypted-quote',
    quoteVersion: 1,
    kind: 'image',
    modelId: 'image-v1',
    credits: 18,
    breakdown: [{ key: 'image-v1', label: 'Image V1', credits: 18 }],
    canAfford: true,
    userBalance: 100,
    expiresAt: '2099-08-25T20:00:00+08:00',
    normalizedParameters: {
      kind: 'image',
      modelId: 'image-v1',
      prompt: 'cat',
      aspectRatioId: '16:9',
    },
    requiresConfirmation: true,
    ...overrides,
  }
}

describe('Laravel generation quote client', () => {
  it('uses the current opaque grant and returns a no-store authoritative quote', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      JSON.stringify(quote()),
      { status: 200, headers },
    ))
    const client = new LaravelGenerationQuoteClient({ baseURL: 'https://api.shotgo.cn', fetch })

    await expect(client.quote({
      capabilityGrant: 'opaque-grant',
      sessionId: 'session-1',
      kind: 'image',
      modelId: 'image-v1',
      parameters: { prompt: 'cat', aspectRatioId: '16:9' },
    })).resolves.toMatchObject({ quoteId: 'opaque-encrypted-quote', credits: 18, requiresConfirmation: true })

    const call = fetch.mock.calls[0]
    expect(call?.[0]).toBe('https://api.shotgo.cn/api/agent/v1/generation-quotes')
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer opaque-grant')
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        sessionId: 'session-1',
        kind: 'image',
        modelId: 'image-v1',
        parameters: { prompt: 'cat', aspectRatioId: '16:9' },
      }),
    })
  })

  it('fails closed for changed scope, cache policy, expiry, or unknown response fields', async () => {
    const cases = [
      new Response(JSON.stringify(quote({ kind: 'video' })), { status: 200, headers }),
      new Response(JSON.stringify(quote()), {
        status: 200,
        headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
      }),
      new Response(JSON.stringify(quote({ expiresAt: '2020-01-01T00:00:00Z' })), { status: 200, headers }),
      new Response(JSON.stringify(quote({ provider: 'must-not-leak' })), { status: 200, headers }),
      new Response(JSON.stringify(quote({ requiresConfirmation: false })), { status: 200, headers }),
    ]

    for (const response of cases) {
      const client = new LaravelGenerationQuoteClient({
        baseURL: 'https://api.shotgo.cn',
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(response),
      })
      await expect(client.quote({
        capabilityGrant: 'opaque-grant',
        sessionId: 'session-1',
        kind: 'image',
        modelId: 'image-v1',
        parameters: { prompt: 'cat' },
      })).rejects.toThrow()
    }
  })
})
