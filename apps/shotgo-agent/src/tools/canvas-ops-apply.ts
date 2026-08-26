import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '../canvas-plan.ts'

export const name = 'shotgo-canvas-ops-apply'
export const inject = ['tools', 'approval']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_ops_apply',
    description: 'Apply one Laravel-quoted Canvas plan after trusted one-shot UI approval. Only the new nodes and new connections bound into the quote can be created.',
    parameters: {
      quoteId: { type: 'string', required: true, description: 'Opaque quote returned by canvas_plan_quote.' },
      quoteVersion: { type: 'number', required: true, const: 1 },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      const submitter = ctx.get('shotgoCanvasPlanSubmitter')
      const sessionId = execution.agent?.session.id
      if (submitter === undefined) throw new Error('CANVAS_PLAN_APPLY_UNAVAILABLE')
      if (sessionId === undefined) throw new Error('CANVAS_PLAN_SESSION_REQUIRED')
      const result = await submitter.apply({
        sessionId,
        actionId: execution.callId,
        quoteId: args.quoteId,
        quoteVersion: 1,
        signal: execution.signal,
      })
      const snapshot = snapshotJsonValue(result)
      if (snapshot === undefined || snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object') throw new Error('CANVAS_PLAN_RESULT_JSON_REQUIRED')
      return snapshot as unknown as Record<string, JsonValue>
    },
    presentCall: () => ({ card: 'generic', title: '确认并新增画布内容', kind: 'execute' }),
  }))
}
