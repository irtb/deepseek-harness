import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SHOTGO_ARK_MODELS,
  SHOTGO_ARK_PROVIDER,
  createArkAdapter,
  resolveArkMessagesBaseURL,
} from '../src/llm/ark.ts'
import { SHOTGO_PROTOCOL_VERSION, type InferenceRuntimeConfig } from '../src/contracts/laravel-v1.ts'

const userId = '00000000-0000-4000-8000-000000000001' as AnonymousUserId
const messages = [createUserMessage({
  content: [{ type: 'text', text: 'plan an image' }],
  source: { kind: 'user' },
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

function messagesSse(events: Array<{ type: string } & Record<string, unknown>>): string {
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

afterEach(() => vi.unstubAllGlobals())

describe('ShotGo Ark LLM adapter', () => {
  it('rewrites OpenAI /api/v3 roots onto the Anthropic-compatible Messages host', () => {
    expect(resolveArkMessagesBaseURL('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/compatible',
    )
    expect(resolveArkMessagesBaseURL('https://ark.cn-beijing.volces.com/api/v3/')).toBe(
      'https://ark.cn-beijing.volces.com/api/compatible',
    )
    expect(resolveArkMessagesBaseURL('https://ark.cn-beijing.volces.com/api/compatible')).toBe(
      'https://ark.cn-beijing.volces.com/api/compatible',
    )
  })

  it('routes prepareCall streams through logical-to-wire model remapping', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      messagesSse([
        { type: 'message_start', message: { id: 'msg_1', model: 'endpoint-flash', usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]),
      { headers: { 'content-type': 'text/event-stream' } },
    ))
    vi.stubGlobal('fetch', request)
    const adapter = createArkAdapter({ resolveRuntimeConfig: () => runtimeConfiguration, resolveUserId: () => userId })

    const prepared = await adapter.prepareCall(SHOTGO_ARK_PROVIDER, 'deepseek-v4-flash')
    await drain(prepared.stream({
      provider: SHOTGO_ARK_PROVIDER,
      model: 'deepseek-v4-flash',
      messages,
    }))

    expect(request).toHaveBeenCalledOnce()
    if (typeof request.mock.calls[0]?.[1]?.body !== 'string') throw new Error('Expected JSON request body')
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ model: 'endpoint-flash' })
  })

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
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      messagesSse([
        { type: 'message_start', message: { id: 'msg_1', model: 'endpoint-flash', usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'done' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]),
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
    // Laravel may still store the OpenAI /api/v3 root; the adapter must hit Messages-compatible /api/compatible.
    expect(request.mock.calls[0]?.[0]).toBe('https://ark.example.test/api/compatible/v1/messages')
    const init = request.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('x-api-key')).toBe('ark-test-key')
    if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'endpoint-flash',
      stream: true,
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
    })
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: expect.objectContaining({ inputTokens: 3, outputTokens: 2 }),
    }))
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }))
  })

  it('reports metadata-only token usage for a session request', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(
      messagesSse([
        { type: 'message_start', message: { id: 'msg_1', model: 'endpoint-flash', usage: { input_tokens: 7, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]),
      { headers: { 'content-type': 'text/event-stream' } },
    )))
    const reportUsage = vi.fn()
    const adapter = createArkAdapter({ resolveRuntimeConfig: () => runtimeConfiguration, resolveUserId: () => userId, reportUsage })

    await drain(adapter.stream({
      provider: SHOTGO_ARK_PROVIDER,
      model: 'deepseek-v4-flash',
      messages,
      sessionId: SessionId('session-usage-1'),
    }))

    expect(reportUsage).toHaveBeenCalledOnce()
    expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-usage-1',
      provider: 'volcengine-ark',
      model: 'deepseek-v4-flash',
      status: 'completed',
      usage: expect.objectContaining({ inputTokens: 7, outputTokens: 3 }),
    }))
    expect(reportUsage.mock.calls[0]?.[0]).not.toHaveProperty('prompt')
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
