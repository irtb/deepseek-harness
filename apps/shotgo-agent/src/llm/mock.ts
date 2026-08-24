/** Keyless Phase 0A LLM adapter proving one read-only ShotGo tool round trip. */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

export const SHOTGO_MOCK_PROVIDER = 'shotgo-mock'
export const SHOTGO_MOCK_MODEL = 'shotgo-mock'

/** Deterministic keyless provider used only before the Laravel inference protocol is frozen. */
export class ShotGoMockLlmAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'ShotGo Phase 0A Mock' })
  }

  // oxlint-disable-next-line typescript/require-await -- the LlmAdapter streaming contract is an async iterable.
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) {
      yield {
        type: 'finish',
        reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'ShotGo mock inference was cancelled' } },
      }
      return
    }

    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const argumentsJson = JSON.stringify({ kind: 'image' })
      const id = CallId('shotgo-generation-config-read')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'generation_config_read', argumentsDelta: argumentsJson }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: 'generation_config_read', arguments: argumentsJson },
      }
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const answer = '当前可用图片模型：ShotGo Image Mock。此结果来自只读 generation_config_read 工具。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 8 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'shotgo-mock-llm'
export const inject = ['llm']

/** Register the Phase 0A mock route. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([SHOTGO_MOCK_PROVIDER], new ShotGoMockLlmAdapter())
}
