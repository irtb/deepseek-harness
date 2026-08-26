import { describe, expect, it, vi } from 'vitest'
import { LaravelCanvasPlanClient } from '../src/laravel/canvas-plan-client.ts'

const headers = { 'X-ShotGo-Protocol-Version': '2026-08-26.1' }

function quote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: '2026-08-26.1', quoteId: 'opaque-quote', quoteVersion: 1, quoteKind: 'canvas-plan',
    authorizationContextId: 'authctx-1', sessionId: 'session-1', userId: 7, teamId: null,
    spaceId: 'space-1', projectId: 'project-1', planId: 'plan-1', revision: 'a'.repeat(32), summary: '新增两个节点',
    nodes: [{ tempId: 'copy', nodeKey: 'node-1', name: '文案', kind: 'text' }], dependencies: [],
    credits: 1, billingMode: 'virtual', expiresAt: '2099-08-26T00:00:00Z', requiresConfirmation: true,
    ...overrides,
  }
}

describe('Laravel Canvas plan client', () => {
  it('sends the opaque Grant and idempotency key and validates authoritative responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(quote()), { status: 200, headers }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        protocolVersion: '2026-08-26.1', planId: 'plan-1', projectId: 'project-1',
        nodeKeys: ['node-1'], connectionKeys: [], credits: 1, billingMode: 'virtual', replayed: false,
      }), { status: 202, headers }))
    const client = new LaravelCanvasPlanClient({ baseURL: 'https://api.shotgo.cn', fetch })
    await expect(client.quote({
      capabilityGrant: 'grant', sessionId: 'session-1', revision: 'a'.repeat(32), summary: '新增两个节点',
      nodes: [{ tempId: 'copy', name: '文案', kind: 'text' }], dependencies: [],
    })).resolves.toMatchObject({ planId: 'plan-1', credits: 1 })
    await expect(client.apply({
      capabilityGrant: 'grant', sessionId: 'session-1', runId: 'run-1', actionId: 'action-1',
      clientRequestId: 'request-1', quoteId: 'opaque-quote', quoteVersion: 1,
    })).resolves.toMatchObject({ nodeKeys: ['node-1'], replayed: false })
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer grant')
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBe('request-1')
  })

  it('fails closed on protocol drift, leaked fields, malformed nodes, and non-virtual credit data', async () => {
    const cases = [
      [quote(), { 'X-ShotGo-Protocol-Version': 'unsupported' }],
      [quote({ providerSecret: 'leak' }), headers],
      [quote({ nodes: [{ tempId: 'copy', nodeKey: 'node-1', name: '文案', kind: 'unknown' }] }), headers],
      [quote({ credits: 8 }), headers],
    ] as const
    for (const [body, responseHeaders] of cases) {
      const client = new LaravelCanvasPlanClient({
        baseURL: 'https://api.shotgo.cn',
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
          new Response(JSON.stringify(body), { status: 200, headers: responseHeaders }),
        ),
      })
      await expect(client.quote({
        capabilityGrant: 'grant', sessionId: 'session-1', revision: 'a'.repeat(32), summary: '计划',
        nodes: [{ tempId: 'copy', name: '文案', kind: 'text' }], dependencies: [],
      })).rejects.toThrow('CANVAS_PLAN_QUOTE_RESPONSE_INVALID')
    }
  })
})
