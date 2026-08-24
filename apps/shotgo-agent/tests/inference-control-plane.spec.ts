import { describe, expect, it, vi } from 'vitest'
import { SHOTGO_PROTOCOL_HEADER, SHOTGO_PROTOCOL_VERSION, type InferenceUsageReport } from '../src/contracts/laravel-v1.ts'
import { InferenceControlPlaneClient, InferenceControlPlaneError } from '../src/laravel/inference-control-plane.ts'
import { InferenceRuntimeConfigStore } from '../src/laravel/inference-runtime-config.ts'

const usageReport: InferenceUsageReport = {
  protocolVersion: SHOTGO_PROTOCOL_VERSION,
  llmRequestId: 'llm-request-1',
  sessionId: 'session-1',
  runId: 'run-1',
  purpose: 'agent-turn',
  provider: 'volcengine-ark',
  model: 'deepseek-v4-flash',
  status: 'completed',
  startedAt: '2026-08-24T08:00:00.000Z',
  completedAt: '2026-08-24T08:00:01.000Z',
  durationMs: 1000,
  usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5 },
}

describe('InferenceControlPlaneClient', () => {
  it('reads an expiring Laravel policy without requesting provider credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      protocolVersion: SHOTGO_PROTOCOL_VERSION,
      policyVersion: 'policy-1',
      provider: 'volcengine-ark',
      allowedModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-v4-flash',
      defaultReasoningEffort: 'high',
      maxOutputTokens: 8192,
      sessionTokenBudget: 100000,
      expiresAt: '2099-08-24T09:00:00.000Z',
    }), { headers: { [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION } }))
    const client = new InferenceControlPlaneClient({ baseURL: 'https://api.shotgo.cn', serviceToken: 'service-token', fetch: request })

    const policy = await client.readPolicy('capability-grant')

    expect(policy.defaultModel).toBe('deepseek-v4-flash')
    expect(request.mock.calls[0]?.[0]).toBe('https://api.shotgo.cn/api/agent/v1/inference-policy')
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer capability-grant')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('ARK_API_KEY')
  })

  it('reports metadata-only usage idempotently with service authentication', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 202,
      headers: { [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION },
    }))
    const client = new InferenceControlPlaneClient({ baseURL: 'https://api.shotgo.cn/', serviceToken: 'service-token', fetch: request })

    await client.reportUsage(usageReport)

    expect(request.mock.calls[0]?.[0]).toBe('https://api.shotgo.cn/api/internal/agent/v1/inference-usage')
    expect(request.mock.calls[0]?.[1]?.method).toBe('POST')
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers)
    expect(headers.get('authorization')).toBe('Bearer service-token')
    expect(headers.get('idempotency-key')).toBe('llm-request-1')
    expect(request.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(usageReport))
  })

  it('loads service-only runtime configuration into a fail-closed memory store', async () => {
    const configuration = {
      protocolVersion: SHOTGO_PROTOCOL_VERSION,
      configurationVersion: 'inference-config-1',
      provider: 'volcengine-ark',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'runtime-secret',
      models: {
        'deepseek-v4-flash': 'endpoint-flash',
        'deepseek-v4-pro': 'endpoint-pro',
      },
    } as const
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(configuration), {
      headers: {
        [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
        'Cache-Control': 'no-store, private',
      },
    }))
    const client = new InferenceControlPlaneClient({ baseURL: 'https://api.shotgo.cn', serviceToken: 'service-token', fetch: request })
    const store = new InferenceRuntimeConfigStore(client)

    expect(store.isReady()).toBe(false)
    expect(() => store.snapshot()).toThrow('INFERENCE_RUNTIME_CONFIG_UNAVAILABLE')
    await expect(store.refresh()).resolves.toEqual(configuration)
    expect(store.isReady()).toBe(true)
    expect(store.snapshot().models['deepseek-v4-flash']).toBe('endpoint-flash')
    expect(request.mock.calls[0]?.[0]).toBe('https://api.shotgo.cn/api/internal/agent/v1/inference-runtime-config')
    expect(request.mock.calls[0]?.[1]?.cache).toBe('no-store')
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer service-token')
  })

  it('clears runtime readiness when refresh fails or returns cacheable credentials', async () => {
    const valid = new Response(JSON.stringify({
      protocolVersion: SHOTGO_PROTOCOL_VERSION,
      configurationVersion: 'inference-config-1',
      provider: 'volcengine-ark',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'runtime-secret',
      models: { 'deepseek-v4-flash': 'endpoint-flash', 'deepseek-v4-pro': 'endpoint-pro' },
    }), { headers: { [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION, 'Cache-Control': 'no-store' } })
    const cacheable = new Response('{}', { headers: { [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION } })
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(valid).mockResolvedValueOnce(cacheable)
    const store = new InferenceRuntimeConfigStore(new InferenceControlPlaneClient({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch: request,
    }))

    await store.refresh()
    await expect(store.refresh()).rejects.toMatchObject({ code: 'RUNTIME_CONFIG_CACHE_POLICY_INVALID' })
    expect(store.isReady()).toBe(false)
    expect(() => store.snapshot()).toThrow('INFERENCE_RUNTIME_CONFIG_UNAVAILABLE')
  })

  it('fails closed on protocol drift and forbidden content fields', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const client = new InferenceControlPlaneClient({ baseURL: 'https://api.shotgo.cn', serviceToken: 'service-token', fetch: request })

    await expect(client.readPolicy('capability-grant')).rejects.toMatchObject({
      code: 'PROTOCOL_VERSION_MISMATCH',
    } satisfies Partial<InferenceControlPlaneError>)
    await expect(client.reportUsage({ ...usageReport, prompt: 'secret' } as InferenceUsageReport)).rejects.toMatchObject({
      code: 'FORBIDDEN_USAGE_FIELD',
    })
  })

  it('rejects expired or widened inference policy', async () => {
    const headers = { [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION }
    const basePolicy = {
      protocolVersion: SHOTGO_PROTOCOL_VERSION,
      policyVersion: 'policy-1',
      provider: 'volcengine-ark',
      allowedModels: ['deepseek-v4-flash'],
      defaultModel: 'deepseek-v4-flash',
      defaultReasoningEffort: 'high',
      maxOutputTokens: 8192,
      sessionTokenBudget: 100000,
      expiresAt: '2099-08-24T09:00:00.000Z',
    }
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...basePolicy, allowedModels: ['deepseek-v4-flash', 'unapproved-model'] }), { headers }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...basePolicy, expiresAt: '2026-08-24T08:00:00.000Z' }), { headers }))
    const client = new InferenceControlPlaneClient({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch: request,
      now: () => Date.parse('2026-08-24T08:30:00.000Z'),
    })

    await expect(client.readPolicy('capability-grant')).rejects.toMatchObject({ code: 'INVALID_INFERENCE_POLICY' })
    await expect(client.readPolicy('capability-grant')).rejects.toMatchObject({ code: 'INFERENCE_POLICY_EXPIRED' })
  })
})
