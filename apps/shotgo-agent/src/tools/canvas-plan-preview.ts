import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'shotgo-canvas-plan-preview'
export const inject = ['tools']

function validText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_plan_preview',
    description: 'Present a read-only structured plan for proposed canvas nodes. This tool never writes canvas data or charges credits.',
    parameters: {
      summary: { type: 'string', required: true, description: 'Concise plan summary.' },
      nodes: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        tempId: { type: 'string', required: true }, name: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['text', 'image', 'video', 'audio'] },
      } } },
      dependencies: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        from: { type: 'string', required: true }, to: { type: 'string', required: true },
      } } },
      modelId: { type: 'string', required: true },
      estimatedCredits: { type: 'number', required: true, description: 'Estimate only; final charge requires a Laravel quote.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      if (args.nodes.length === 0 || args.nodes.length > 12 || args.dependencies.length > 24
        || !Number.isSafeInteger(args.estimatedCredits) || args.estimatedCredits < 0) {
        throw new Error('CANVAS_PLAN_LIMIT_EXCEEDED')
      }
      if (!validText(args.summary, 2_000) || !validText(args.modelId, 128)
        || args.nodes.some(node => !validText(node.tempId, 128) || !validText(node.name, 256))) {
        throw new Error('CANVAS_PLAN_INVALID_CONTENT')
      }
      const ids = new Set(args.nodes.map(node => node.tempId))
      const edges = new Set(args.dependencies.map(edge => `${edge.from}\u0000${edge.to}`))
      if (ids.size !== args.nodes.length
        || edges.size !== args.dependencies.length
        || args.dependencies.some(edge => edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to))) {
        throw new Error('CANVAS_PLAN_INVALID_DEPENDENCY')
      }
      return Promise.resolve({ schemaVersion: 1, readOnly: true, requiresConfirmation: true, ...args })
    },
    presentCall: () => ({ card: 'generic', title: '整理画布计划', kind: 'read' }),
  }))
}
