import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
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
  type ResolvedRetryPolicy,
  type RetryPolicyConfig,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  type DeepSeekConnectionOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import z from '@deepseek-ai/schemastery'
import { SHOTGO_PROTOCOL_VERSION, type InferenceModel, type InferenceRuntimeConfig, type InferenceUsageReport } from '../contracts/laravel-v1.ts'
import { InferenceControlPlaneClient } from '../laravel/inference-control-plane.ts'
import { InferenceRuntimeConfigStore } from '../laravel/inference-runtime-config.ts'

export const SHOTGO_ARK_PROVIDER = 'volcengine-ark'
export const SHOTGO_ARK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const
const LARAVEL_CREDENTIAL_REF = credentialRef('SHOTGO_LARAVEL_RUNTIME_CONFIG')
const REFRESH_INTERVAL_MS = 60_000

const modelSet = new Set<string>(SHOTGO_ARK_MODELS)
export interface ArkAdapterOptions {
  resolveRuntimeConfig: () => InferenceRuntimeConfig
  reportUsage?: (report: InferenceUsageReport) => Promise<void>
  resolveUserId?: () => AnonymousUserId
  maxTokens?: number
  reasoningEffort?: 'off' | 'high' | 'max'
  retryPolicy?: RetryPolicyConfig
}

function resolveConnection(
  options: ArkAdapterOptions,
  configuration: InferenceRuntimeConfig,
  wireModels = false,
): DeepSeekConnectionOptions {
  const maxTokens = options.maxTokens ?? 16_384
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('shotgo-ark.maxTokens must be positive')
  return {
    baseURL: configuration.baseURL,
    apiKeyEnv: LARAVEL_CREDENTIAL_REF,
    defaults: { thinking: options.reasoningEffort === 'off' ? 'disabled' : 'enabled', reasoningEffort: options.reasoningEffort ?? 'high' },
    maxTokens,
    defaultContextWindow: 1_000_000,
    models: [
      {
        id: wireModels ? configuration.models['deepseek-v4-flash'] : 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1_000_000,
        maxTokens,
      },
      {
        id: wireModels ? configuration.models['deepseek-v4-pro'] : 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
        maxTokens,
      },
    ],
    streamIdleTimeoutMs: 300_000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    retryPolicy: resolveRetryPolicy(options.retryPolicy, 'shotgo-ark.retryPolicy'),
  }
}

/** Product-owned policy wrapper around the upstream OpenAI-compatible transport. */
export class ShotGoArkLlmAdapter extends DeepSeekAdapter {
  constructor(private readonly shotgoOptions: ArkAdapterOptions) {
    super({
      options: () => resolveConnection(shotgoOptions, shotgoOptions.resolveRuntimeConfig()),
      resolveApiKey: () => Promise.resolve(assertUsableApiKey(
        shotgoOptions.resolveRuntimeConfig().apiKey,
        'shotgo-ark',
        LARAVEL_CREDENTIAL_REF,
      )),
      resolveUserId: shotgoOptions.resolveUserId ?? (() => getOrCreateAnonymousUserId()),
    })
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Volcano Ark' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return resolveRetryPolicy(this.shotgoOptions.retryPolicy, 'shotgo-ark.retryPolicy')
  }

  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.assertAllowedModel(model)
    return super.resolveModel(provider, model, signal)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.assertAllowedModel(options.model)
    const configuration = this.shotgoOptions.resolveRuntimeConfig()
    const logicalModel = options.model as InferenceModel
    const delegate = new DeepSeekAdapter({
      options: () => resolveConnection(this.shotgoOptions, configuration, true),
      resolveApiKey: () => Promise.resolve(assertUsableApiKey(
        configuration.apiKey,
        'shotgo-ark',
        LARAVEL_CREDENTIAL_REF,
      )),
      resolveUserId: this.shotgoOptions.resolveUserId ?? (() => getOrCreateAnonymousUserId()),
    })
    const startedAt = new Date()
    const llmRequestId = randomUUID()
    let usage: InferenceUsageReport['usage'] = { inputTokens: 0, outputTokens: 0 }
    let terminal: Extract<StreamChunk, { type: 'finish' }> | undefined
    try {
      for await (const chunk of delegate.stream({ ...options, model: configuration.models[logicalModel] })) {
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') {
          terminal = chunk
          break
        }
        yield chunk
      }
    } catch (error) {
      await this.report(options, logicalModel, llmRequestId, startedAt, usage, 'failed', 'INFERENCE_STREAM_FAILED')
      throw error
    }
    if (terminal === undefined) return
    const status = terminal.reason.kind === 'aborted' ? 'cancelled' : terminal.reason.kind === 'error' ? 'failed' : 'completed'
    const errorCode = terminal.reason.kind === 'error' ? 'INFERENCE_PROVIDER_ERROR' : terminal.reason.kind === 'aborted' ? 'INFERENCE_CANCELLED' : undefined
    await this.report(options, logicalModel, llmRequestId, startedAt, usage, status, errorCode)
    yield terminal
  }

  private async report(
    options: GenerateOptions,
    model: InferenceModel,
    llmRequestId: string,
    startedAt: Date,
    usage: InferenceUsageReport['usage'],
    status: InferenceUsageReport['status'],
    errorCode?: string,
  ): Promise<void> {
    if (options.sessionId === undefined || this.shotgoOptions.reportUsage === undefined) return
    const completedAt = new Date()
    try {
      await this.shotgoOptions.reportUsage({
        protocolVersion: SHOTGO_PROTOCOL_VERSION,
        llmRequestId,
        sessionId: String(options.sessionId),
        ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
        provider: SHOTGO_ARK_PROVIDER,
        model,
        status,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        usage,
        ...(errorCode === undefined ? {} : { errorCode }),
      })
    } catch {
      // Usage reporting is audit-only while inference billing is disabled; it must not corrupt a completed model stream.
    }
  }

  private assertAllowedModel(model: string): void {
    if (!modelSet.has(model)) {
      throw new LlmError(`Ark model "${model}" is not enabled by ShotGo`, 'MODEL_NOT_ALLOWED')
    }
  }
}

export function createArkAdapter(options: ArkAdapterOptions): ShotGoArkLlmAdapter {
  return new ShotGoArkLlmAdapter(options)
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
export async function apply(ctx: Context, config: Config): Promise<void> {
  const baseURL = process.env.SHOTGO_LARAVEL_BASE_URL?.trim() ?? ''
  const serviceToken = process.env.SHOTGO_LARAVEL_SERVICE_TOKEN?.trim() ?? ''
  const controlPlane = baseURL === '' || serviceToken === ''
    ? undefined
    : new InferenceControlPlaneClient({ baseURL, serviceToken })
  const store = controlPlane === undefined ? undefined : new InferenceRuntimeConfigStore(controlPlane)

  if (store !== undefined) {
    try {
      await store.refresh()
    } catch (_runtimeConfigurationUnavailable) {
      ctx.logger.warn('shotgo-ark: Laravel inference runtime configuration is unavailable; requests fail closed')
    }
    const interval = setInterval(() => {
      void store.refresh().catch(() => {
        ctx.logger.warn('shotgo-ark: Laravel inference runtime configuration refresh failed; requests fail closed')
      })
    }, REFRESH_INTERVAL_MS)
    interval.unref()
    ctx.effect(() => () => {
      clearInterval(interval)
    }, 'shotgo-ark: refresh Laravel runtime configuration')
  }

  ctx.llm.registerAdapter([SHOTGO_ARK_PROVIDER], createArkAdapter({
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
    ...(config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy }),
    resolveRuntimeConfig: () => {
      if (store === undefined) throw new LlmError('Laravel inference runtime configuration is not configured', 'MISSING_CREDENTIAL')
      return store.snapshot()
    },
    ...(controlPlane === undefined ? {} : { reportUsage: (report: InferenceUsageReport) => controlPlane.reportUsage(report) }),
  }))
}
