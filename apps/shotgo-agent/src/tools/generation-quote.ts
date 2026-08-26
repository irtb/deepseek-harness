/** Read-only authoritative generation quote tool. */

import type { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenerationQuoteParameters, GenerationQuoteResponse } from '../contracts/laravel-v1.ts'
import type {} from '../generation-quote.ts'

export const name = 'shotgo-generation-quote'
export const inject = ['tools', 'shotgoGenerationQuoteRegistry']

/** Register the Grant-bound generation quote tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generation_quote',
    description: 'Request an authoritative ShotGo credit quote after generation parameters are complete. This operation does not charge credits or submit generation.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['image', 'video'],
        description: 'Asset generation kind.',
      },
      modelId: { type: 'string', required: true, description: 'Selected model id from generation_config_read.' },
      prompt: { type: 'string', required: true, description: 'Final generation prompt to bind to the quote.' },
      qualityId: { type: 'string', description: 'Selected image quality id.' },
      resolutionId: { type: 'string', description: 'Selected resolution id.' },
      aspectRatioId: { type: 'string', description: 'Selected aspect-ratio id.' },
      duration: { type: 'number', description: 'Selected video duration in seconds.' },
      fps: { type: 'number', description: 'Selected video frame rate.' },
      audio: { type: 'boolean', description: 'Whether generated video includes audio.' },
      operationType: { type: 'string', description: 'Selected video operation type.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quoteId: { type: 'string', required: true },
          quoteVersion: { type: 'number', required: true, const: 1 },
          kind: { type: 'string', required: true, enum: ['image', 'video'] },
          modelId: { type: 'string', required: true },
          credits: { type: 'number', required: true },
          breakdown: { type: 'json', required: true },
          canAfford: { type: 'boolean', required: true },
          userBalance: { type: 'number', required: true },
          expiresAt: { type: 'string', required: true },
          normalizedParameters: { type: 'json', required: true },
          requiresConfirmation: { type: 'boolean', required: true, const: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const reader = ctx.get('shotgoGenerationQuoteReader')
      if (reader === undefined) throw new Error('GENERATION_QUOTE_UNAVAILABLE')
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) throw new Error('GENERATION_QUOTE_SESSION_REQUIRED')
      const parameters: GenerationQuoteParameters = { prompt: args.prompt }
      for (const key of [
        'qualityId', 'resolutionId', 'aspectRatioId',
        'duration', 'fps', 'audio', 'operationType',
      ] as const) {
        const value = args[key]
        if (value !== undefined) parameters[key] = value
      }
      const quote = await reader.quote({
        sessionId,
        kind: args.kind,
        modelId: args.modelId,
        parameters,
        signal: exec.signal,
      })
      ctx.shotgoGenerationQuoteRegistry.record(sessionId, quote)
      return toolResult(quote)
    },
    presentCall: args => ({
      card: 'generic',
      title: args.kind === 'image' ? '获取图片生成报价' : '获取视频生成报价',
      kind: 'read',
    }),
  }))
}

function toolResult(quote: GenerationQuoteResponse) {
  return {
    quoteId: quote.quoteId,
    quoteVersion: quote.quoteVersion,
    kind: quote.kind,
    modelId: quote.modelId,
    credits: quote.credits,
    breakdown: jsonValue(quote.breakdown),
    canAfford: quote.canAfford,
    userBalance: quote.userBalance,
    expiresAt: quote.expiresAt,
    normalizedParameters: jsonValue(quote.normalizedParameters),
    requiresConfirmation: quote.requiresConfirmation,
  }
}

function jsonValue(value: object): JsonValue {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('GENERATION_QUOTE_JSON_VALUE_REQUIRED')
  return snapshot as JsonValue
}
