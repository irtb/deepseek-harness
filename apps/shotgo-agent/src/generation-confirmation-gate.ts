/** Fail-closed human approval gate for generation submission. */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'shotgo-generation-confirmation-gate'
export const inject = ['tools', 'approval', 'shotgoGenerationQuoteRegistry']

/** Require a one-shot UI approval immediately before charge or cancellation mutations. */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', (execution, next) => {
    if (execution.name === 'generation_cancel') {
      const input = asRecord(execution.arguments)
      const generationId = typeof input.generationId === 'string' ? input.generationId : '未知任务'
      return Promise.resolve({
        kind: 'ask' as const,
        reason: `确认取消生成任务 ${generationId}。取消可能与任务完成同时发生，最终状态以 Laravel 返回为准。批准仅对本次工具调用有效。`,
      })
    }
    if (execution.name !== 'generation_submit') return next()
    const input = asRecord(execution.arguments)
    const sessionId = execution.agent?.session.id
    const quoteId = typeof input.quoteId === 'string' ? input.quoteId : undefined
    if (sessionId === undefined || quoteId === undefined) throw new Error('GENERATION_QUOTE_CONFIRMATION_REQUIRED')
    const quote = ctx.shotgoGenerationQuoteRegistry.take(sessionId, quoteId)
    if (quote === undefined || input.quoteVersion !== quote.quoteVersion) {
      throw new Error('GENERATION_QUOTE_CONFIRMATION_REQUIRED')
    }
    const kind = quote.kind === 'video' ? '视频' : '图片'
    const prompt = typeof quote.normalizedParameters.prompt === 'string'
      ? quote.normalizedParameters.prompt.slice(0, 160)
      : '未提供'
    const settings = Object.fromEntries(Object.entries(quote.normalizedParameters)
      .filter(([key]) => !['prompt', 'kind', 'modelId'].includes(key)))
    return Promise.resolve({
      kind: 'ask' as const,
      reason: `确认使用 ${quote.modelId} 生成${kind}，将扣除 ${quote.credits} 积分。提示词：${prompt}。设置：${JSON.stringify(settings)}。批准仅对本次工具调用有效。`,
    })
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
