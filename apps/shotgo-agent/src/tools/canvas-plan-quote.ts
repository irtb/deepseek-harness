import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '../canvas-plan.ts'
import type {} from '../canvas-plan-quote-registry.ts'

export const name = 'shotgo-canvas-plan-quote'
export const inject = ['tools', 'shotgoCanvasPlanQuoteRegistry']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_plan_quote',
    description: 'Bind an exact additive-only Canvas plan to the latest Laravel revision and obtain stable node/edge keys plus a short-lived one-shot confirmation quote. The displayed 1 Agent credit is virtual and is not deducted.',
    parameters: {
      revision: { type: 'string', required: true, description: 'Exact revision returned by the latest canvas_context_read.' },
      summary: { type: 'string', required: true },
      nodes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        tempId: { type: 'string', required: true }, name: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['text', 'image', 'video', 'audio'] },
      } } },
      dependencies: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        from: { type: 'string', required: true }, to: { type: 'string', required: true },
      } } },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, execution) {
      const reader = ctx.get('shotgoCanvasPlanQuoteReader')
      const sessionId = execution.agent?.session.id
      if (reader === undefined) throw new Error('CANVAS_PLAN_QUOTE_UNAVAILABLE')
      if (sessionId === undefined) throw new Error('CANVAS_PLAN_SESSION_REQUIRED')
      const quote = await reader.quote({
        sessionId,
        revision: args.revision,
        summary: args.summary,
        nodes: args.nodes,
        dependencies: args.dependencies,
        signal: execution.signal,
      })
      ctx.shotgoCanvasPlanQuoteRegistry.record(sessionId, quote)
      const snapshot = snapshotJsonValue(quote)
      if (snapshot === undefined || snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object') throw new Error('CANVAS_PLAN_QUOTE_JSON_REQUIRED')
      return snapshot as unknown as Record<string, JsonValue>
    },
    presentCall: () => ({ card: 'generic', title: '冻结 Canvas 新增计划', kind: 'read' }),
  }))
}
