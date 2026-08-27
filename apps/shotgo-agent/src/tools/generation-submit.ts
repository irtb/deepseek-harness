/** Approval-gated, idempotent generation submission tool. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '../generation-submit.ts'

export const name = 'shotgo-generation-submit'
export const inject = ['tools', 'approval']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generation_submit',
    description: 'Submit only the fresh quote returned by generation_quote in the current user turn. The UI asks the user for one-shot approval immediately before dispatch. If the tool reports GENERATION_QUOTE_REFRESH_REQUIRED, call generation_quote again with the same current parameters and retry automatically; never tell the user to click a confirmation button for the stale quote.',
    parameters: {
      quoteId: { type: 'string', required: true, description: 'Opaque quote returned by generation_quote.' },
      quoteVersion: { type: 'number', required: true, const: 1 },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          generationId: { type: 'string', required: true },
          clientRequestId: { type: 'string', required: true },
          state: { type: 'string', required: true, enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'] },
          stage: { type: 'string', required: true },
          credits: { type: 'number', required: true },
          userBalance: { type: 'number', required: true },
          replayed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      const submitter = ctx.get('shotgoGenerationSubmitter')
      if (submitter === undefined) throw new Error('GENERATION_SUBMIT_UNAVAILABLE')
      const sessionId = execution.agent?.session.id
      if (sessionId === undefined) throw new Error('GENERATION_SUBMIT_SESSION_REQUIRED')
      const generation = await submitter.submit({
        sessionId,
        actionId: execution.callId,
        quoteId: args.quoteId,
        quoteVersion: 1,
        signal: execution.signal,
      })
      return {
        generationId: generation.generationId,
        clientRequestId: generation.clientRequestId,
        state: generation.state as 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled',
        stage: generation.stage,
        credits: generation.credits,
        userBalance: generation.userBalance,
        replayed: generation.replayed,
      }
    },
    presentCall: () => ({
      card: 'generic',
      title: '确认并提交生成',
      kind: 'execute',
    }),
  }))
}
