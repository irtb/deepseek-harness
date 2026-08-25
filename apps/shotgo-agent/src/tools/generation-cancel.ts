import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '../generation-lifecycle.ts'

export const name = 'shotgo-generation-cancel'
export const inject = ['tools', 'approval']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generation_cancel',
    description: 'Cancel one non-terminal generation after a trusted one-shot UI confirmation. Laravel resolves cancellation/completion races and returns the authoritative state.',
    parameters: { generationId: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      const lifecycle = ctx.get('shotgoGenerationLifecycle')
      const sessionId = execution.agent?.session.id
      if (lifecycle === undefined) throw new Error('GENERATION_CANCEL_UNAVAILABLE')
      if (sessionId === undefined) throw new Error('GENERATION_CANCEL_SESSION_REQUIRED')
      const value = await lifecycle.cancel({
        sessionId,
        actionId: execution.callId,
        generationId: args.generationId,
        signal: execution.signal,
      })
      return {
        generationId: value.generationId,
        clientRequestId: value.clientRequestId,
        operationId: value.operationId,
        state: value.state,
        stage: value.stage,
        credits: value.credits,
        userBalance: value.userBalance,
        replayed: value.replayed,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
        ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
      }
    },
    presentCall: () => ({ card: 'generic', title: '确认取消生成任务', kind: 'execute' }),
  }))
}
