import { describe, expect, it, vi } from 'vitest'
import { LaravelCapabilityGrantAuthorizer } from '../src/laravel/capability-grant-authorizer.ts'

const protocolHeaders = {
  'Cache-Control': 'no-store',
  'X-ShotGo-Protocol-Version': '2026-08-25.1',
}

function validIntrospection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: '2026-08-25.1',
    active: true,
    authorizationContextId: 'context-personal-space-image-session-1',
    subjectId: 'user:41:personal',
    expiresAt: '2099-01-01T00:00:00.000Z',
    sessionId: 'session-1',
    userId: 41,
    teamId: null,
    spaceId: null,
    projectId: null,
    agentMode: 'image',
    allowedCapabilities: [
      'agent.session.submit',
      'agent.session.events.read',
      'agent.session.cancel',
      'agent.inference',
      'generation.image.create',
    ],
    inferencePolicy: {
      protocolVersion: '2026-08-25.1',
      policyVersion: 'policy-real-api-shape',
      provider: 'volcengine-ark',
      allowedModels: ['deepseek-v4-flash'],
      defaultModel: 'deepseek-v4-flash',
      defaultReasoningEffort: 'high',
      maxOutputTokens: 8_192,
      sessionTokenBudget: 200_000,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

describe('Laravel Capability Grant authorizer', () => {
  it('introspects one personal-space grant with service authentication', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      JSON.stringify(validIntrospection()),
      { status: 200, headers: protocolHeaders },
    ))
    const authorizer = new LaravelCapabilityGrantAuthorizer({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch,
    })

    await expect(authorizer.authorize({
      capabilityGrant: 'opaque-grant',
      sessionId: 'session-1',
      requiredCapability: 'agent.session.submit',
    })).resolves.toMatchObject({
      authorizationContextId: 'context-personal-space-image-session-1',
      userId: 41,
      teamId: null,
      spaceId: null,
      projectId: null,
      model: 'deepseek-v4-flash',
      maxTokens: 8_192,
    })

    expect(fetch).toHaveBeenCalledOnce()
    const call = fetch.mock.calls[0]
    expect(call?.[0]).toBe('https://api.shotgo.cn/api/internal/agent/v1/grants/introspect')
    expect(call?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        grantToken: 'opaque-grant',
        sessionId: 'session-1',
        requiredCapability: 'agent.session.submit',
      }),
      cache: 'no-store',
    })
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer service-token')
  })

  it('fails closed for rejected, expired, mismatched, or cacheable introspection', async () => {
    const cases = [
      {
        response: new Response('{}', { status: 403, headers: protocolHeaders }),
        code: 'CAPABILITY_GRANT_REJECTED',
      },
      {
        response: new Response(JSON.stringify(validIntrospection({ expiresAt: '2020-01-01T00:00:00.000Z' })), {
          status: 200,
          headers: protocolHeaders,
        }),
        code: 'CAPABILITY_GRANT_EXPIRED',
      },
      {
        response: new Response(JSON.stringify(validIntrospection({
          inferencePolicy: {
            ...(validIntrospection().inferencePolicy as Record<string, unknown>),
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
        })), {
          status: 200,
          headers: protocolHeaders,
        }),
        code: 'INFERENCE_POLICY_EXPIRED',
      },
      {
        response: new Response(JSON.stringify(validIntrospection({ sessionId: 'another-session' })), {
          status: 200,
          headers: protocolHeaders,
        }),
        code: 'CAPABILITY_SESSION_MISMATCH',
      },
      {
        response: new Response(JSON.stringify(validIntrospection()), {
          status: 200,
          headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' },
        }),
        code: 'CAPABILITY_INTROSPECTION_CACHE_POLICY_INVALID',
      },
    ]

    for (const testCase of cases) {
      const authorizer = new LaravelCapabilityGrantAuthorizer({
        baseURL: 'https://api.shotgo.cn',
        serviceToken: 'service-token',
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(testCase.response),
      })
      await expect(authorizer.authorize({
        capabilityGrant: 'opaque-grant',
        sessionId: 'session-1',
        requiredCapability: 'agent.session.submit',
      })).rejects.toMatchObject({ code: testCase.code })
    }
  })

  it('rejects a response without the requested capability or current protocol', async () => {
    const withoutCapability = new LaravelCapabilityGrantAuthorizer({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
        JSON.stringify(validIntrospection({ allowedCapabilities: ['agent.session.events.read', 'agent.inference'] })),
        { status: 200, headers: protocolHeaders },
      )),
    })
    await expect(withoutCapability.authorize({
      capabilityGrant: 'opaque-grant',
      sessionId: 'session-1',
      requiredCapability: 'agent.session.submit',
    })).rejects.toMatchObject({ code: 'CAPABILITY_NOT_ALLOWED' })

    const wrongProtocol = new LaravelCapabilityGrantAuthorizer({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
        JSON.stringify(validIntrospection()),
        { status: 200, headers: { ...protocolHeaders, 'X-ShotGo-Protocol-Version': 'old' } },
      )),
    })
    await expect(wrongProtocol.authorize({
      capabilityGrant: 'opaque-grant',
      sessionId: 'session-1',
      requiredCapability: 'agent.session.submit',
    })).rejects.toMatchObject({ code: 'LARAVEL_PROTOCOL_VERSION_MISMATCH' })
  })
})
