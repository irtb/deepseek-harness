import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '../generation-lifecycle.ts'

export const name = 'shotgo-generation-status'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generation_status',
    description: 'Read the authoritative Laravel state of one submitted generation.',
    parameters: { generationId: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, execution) {
      const lifecycle = ctx.get('shotgoGenerationLifecycle')
      const sessionId = execution.agent?.session.id
      if (lifecycle === undefined) throw new Error('GENERATION_STATUS_UNAVAILABLE')
      if (sessionId === undefined) throw new Error('GENERATION_STATUS_SESSION_REQUIRED')
      const value = await lifecycle.read({
        sessionId,
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
        ...(value.assets === undefined ? {} : { assets: value.assets }),
        ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode }),
      }
    },
  }))
}
