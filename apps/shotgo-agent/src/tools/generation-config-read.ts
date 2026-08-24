/** Read-only Phase 0A generation-model catalog tool. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const MOCK_IMAGE_MODEL = Object.freeze({
  id: 'shotgo-image-mock',
  label: 'ShotGo Image Mock',
  kind: 'image' as const,
})

export const name = 'shotgo-generation-config-read'
export const inject = ['tools']

/** Register the keyless read-only generation catalog tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'generation_config_read',
    description: 'Read the ShotGo generation models currently available to this session. This operation is read-only.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['image'],
        description: 'Asset generation kind to list. Phase 0A supports image only.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'image' },
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                kind: { type: 'string', required: true, const: 'image' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute() {
      return Promise.resolve({ kind: 'image' as const, models: [MOCK_IMAGE_MODEL] })
    },
    presentCall: () => ({ card: 'generic', title: '读取图片模型配置', kind: 'read' }),
  }))
}
