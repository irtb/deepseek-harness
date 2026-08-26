import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '../canvas-context.ts'

export const name = 'shotgo-canvas-context-read'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_context_read',
    description: 'Read a compact snapshot of only the canvas bound to this session Grant. Read-only; never changes canvas data.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const reader = ctx.get('shotgoCanvasContextReader')
      const sessionId = exec.agent?.session.id
      if (reader === undefined) throw new Error('CANVAS_CONTEXT_READER_UNAVAILABLE')
      if (sessionId === undefined) throw new Error('CANVAS_CONTEXT_SESSION_REQUIRED')
      return await reader.read({ sessionId, signal: exec.signal }) as unknown as Record<string, JsonValue>
    },
    presentCall: () => ({ card: 'generic', title: '读取当前画布', kind: 'read' }),
  }))
}
