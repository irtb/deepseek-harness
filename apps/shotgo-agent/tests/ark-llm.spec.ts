import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SHOTGO_ARK_MODELS,
  SHOTGO_ARK_PROVIDER,
  createArkAdapter,
} from '../src/llm/ark.ts'
import { SHOTGO_PROTOCOL_VERSION, type InferenceRuntimeConfig } from '../src/contracts/laravel-v1.ts'

const userId = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
const messages = [createUserMessage({
  content: [{ type: 'text', text: 'plan an image' }],
  source: { kind: 'plugin', plugin: 'shotgo-test' },
})]
const runtimeConfiguration: InferenceRuntimeConfig = {
  protocolVersion: SHOTGO_PROTOCOL_VERSION,
  configurationVersion: 'inference-config-1',
  provider: 'volcengine-ark',
  baseURL: 'https://ark.example.test/api/v3',
  apiKey: 'ark-test-key',
  models: {
    'deepseek-v4-flash': 'endpoint-flash',
    'deepseek-v4-pro': 'endpoint-pro',
  },
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

afterEach(() => vi.unstubAllGlobals())

describe('ShotGo Ark LLM adapter', () => {
  it('exposes only the approved Flash and Pro models', async () => {
    const adapter = createArkAdapter({ resolveRuntimeConfig: () => runtimeConfiguration, resolveUserId: () => userId })

    await expect(adapter.listModels(SHOTGO_ARK_PROVIDER)).resolves.toEqual([
      expect.objectContaining({ id: 'deepseek-v4-flash' }),
      expect.objectContaining({ id: 'deepseek-v4-pro' }),
    ])
    expect(SHOTGO_ARK_MODELS).toHaveLength(2)
    expect(() => adapter.resolveModel(SHOTGO_ARK_PROVIDER, 'deepseek-v4-flash-vision-exp')).toThrow(expect.objectContaining({
      code: 'MODEL_NOT_ALLOWED',
    }))
  })

  it('streams directly through the Ark OpenAI-compatible endpoint', async () => {
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":"think"}}]}',
      '{"choices":[{"delta":{"content":"done"}}]}',
      '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
      '[DONE]',
    ]
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      events.map(event => `data: ${event}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'ark-request-1' } },
    ))
    vi.stubGlobal('fetch', request)
    const adapter = createArkAdapter({ resolveRuntimeConfig: () => runtimeConfiguration, resolveUserId: () => userId })

    const chunks = await drain(adapter.stream({
      provider: SHOTGO_ARK_PROVIDER,
      model: 'deepseek-v4-flash',
      messages,
    }))

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0]).toBe('https://ark.example.test/api/v3/chat/completions')
    const init = request.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ark-test-key')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'endpoint-flash',
      reasoning_effort: 'high',
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }))
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
  })

  it('fails per request when Laravel runtime configuration is unavailable', async () => {
    const adapter = createArkAdapter({
      resolveRuntimeConfig: () => {
        throw new Error('INFERENCE_RUNTIME_CONFIG_UNAVAILABLE')
      },
      resolveUserId: () => userId,
    })

    await expect(drain(adapter.stream({
      provider: SHOTGO_ARK_PROVIDER,
      model: 'deepseek-v4-pro',
      messages,
    }))).rejects.toThrow('INFERENCE_RUNTIME_CONFIG_UNAVAILABLE')
  })
})
