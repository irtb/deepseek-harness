/** Fail-closed human approval gate for generation submission. */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'shotgo-generation-confirmation-gate'
export const inject = ['tools', 'approval']

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
    const kind = input.kind === 'video' ? '视频' : '图片'
    const modelId = typeof input.modelId === 'string' ? input.modelId : '未知模型'
    const credits = typeof input.credits === 'number' && Number.isSafeInteger(input.credits)
      ? `${input.credits} 积分`
      : '报价中的积分'
    return Promise.resolve({
      kind: 'ask' as const,
      reason: `确认使用 ${modelId} 生成${kind}，预计扣除 ${credits}。批准仅对本次工具调用有效。`,
    })
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
