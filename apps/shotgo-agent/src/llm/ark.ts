import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  assertUsableApiKey,
  LlmError,
  resolveRetryPolicy,
  RetryPolicySchema,
  type GenerateOptions,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type RetryPolicyConfig,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  type DeepSeekConnectionOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import z from '@deepseek-ai/schemastery'

export const SHOTGO_ARK_PROVIDER = 'volcengine-ark'
export const SHOTGO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const SHOTGO_ARK_API_KEY_ENV = 'ARK_API_KEY'
export const SHOTGO_ARK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const

const modelSet = new Set<string>(SHOTGO_ARK_MODELS)
export interface ArkAdapterOptions {
  environment?: Readonly<Record<string, string | undefined>>
  resolveUserId?: () => AnonymousUserId
  maxTokens?: number
  reasoningEffort?: 'off' | 'high' | 'max'
  retryPolicy?: RetryPolicyConfig
}

function resolveConnection(options: ArkAdapterOptions): DeepSeekConnectionOptions {
  const maxTokens = options.maxTokens ?? 16_384
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('shotgo-ark.maxTokens must be positive')
  return {
    baseURL: SHOTGO_ARK_BASE_URL,
    apiKeyEnv: credentialRef(SHOTGO_ARK_API_KEY_ENV),
    defaults: { thinking: options.reasoningEffort === 'off' ? 'disabled' : 'enabled', reasoningEffort: options.reasoningEffort ?? 'high' },
    maxTokens,
    defaultContextWindow: 1_000_000,
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1_000_000, maxTokens },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1_000_000, maxTokens },
    ],
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    retryPolicy: resolveRetryPolicy(options.retryPolicy, 'shotgo-ark.retryPolicy'),
  }
}

/** Product-owned policy wrapper around the upstream OpenAI-compatible transport. */
export class ShotGoArkLlmAdapter extends DeepSeekAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Volcano Ark' }
  }

  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.assertAllowedModel(model)
    return super.resolveModel(provider, model, signal)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.assertAllowedModel(options.model)
    yield* super.stream(options)
  }

  private assertAllowedModel(model: string): void {
    if (!modelSet.has(model)) {
      throw new LlmError(`Ark model "${model}" is not enabled by ShotGo`, 'MODEL_NOT_ALLOWED')
    }
  }
}

export function createArkAdapter(options: ArkAdapterOptions = {}): ShotGoArkLlmAdapter {
  const environment = options.environment ?? process.env
  const connection = resolveConnection(options)
  return new ShotGoArkLlmAdapter({
    options: () => connection,
    resolveApiKey: (snapshot) => {
      const value = environment[SHOTGO_ARK_API_KEY_ENV]
      if (value === undefined || value.length === 0) {
        throw new LlmError(`Missing ${SHOTGO_ARK_API_KEY_ENV} for ${SHOTGO_ARK_PROVIDER}`, 'MISSING_CREDENTIAL')
      }
      return Promise.resolve(assertUsableApiKey(value, 'shotgo-ark', snapshot.apiKeyEnv))
    },
    resolveUserId: options.resolveUserId ?? (() => getOrCreateAnonymousUserId()),
  })
}

export interface Config {
  maxTokens?: number
  reasoningEffort?: 'off' | 'high' | 'max'
  retryPolicy?: RetryPolicyConfig
}
export const Config: z<Config> = z.object({
  maxTokens: z.number().step(1).min(1).default(16_384),
  reasoningEffort: z.union(['off', 'high', 'max']).default('high'),
  retryPolicy: RetryPolicySchema.default({ mode: 'normal', maxRetries: 3 }),
})
export const name = 'shotgo-ark-llm'
export const inject = ['llm']

/** Register the direct Ark route; missing credentials fail at request time, not boot time. */
export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerAdapter([SHOTGO_ARK_PROVIDER], createArkAdapter(config))
}
