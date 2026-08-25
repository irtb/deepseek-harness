/** Read-only Phase 0A generation-model catalog tool. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenerationConfigReadResponse, GenerationKind } from '../contracts/laravel-v1.ts'
import type {} from '../generation-config.ts'

const MOCK_IMAGE_MODEL = Object.freeze({
  id: 'shotgo-image-mock',
  label: 'ShotGo Image Mock',
  kind: 'image' as const,
})

const MOCK_VIDEO_MODEL = Object.freeze({
  id: 'shotgo-video-mock',
  label: 'ShotGo Video Mock',
  kind: 'video' as const,
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
        enum: ['image', 'video'],
        description: 'Asset generation kind to list.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['image', 'video'] },
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['image', 'video'] },
                shortLabel: { type: 'string' },
                description: { type: 'string' },
                credits: { type: 'number' },
                vip: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const reader = ctx.get('shotgoGenerationConfigReader')
      if (reader !== undefined) {
        const sessionId = exec.agent?.session.id
        if (sessionId === undefined) throw new Error('GENERATION_CONFIG_SESSION_REQUIRED')
        const config = await reader.read({
          kind: args.kind,
          sessionId,
          signal: exec.signal,
        })
        return toolResult(config)
      }
      return args.kind === 'image'
        ? { kind: 'image' as const, models: [MOCK_IMAGE_MODEL] }
        : { kind: 'video' as const, models: [MOCK_VIDEO_MODEL] }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.kind === 'image' ? '读取图片模型配置' : '读取视频模型配置',
      kind: 'read',
    }),
  }))
}

function toolResult(config: GenerationConfigReadResponse): {
  kind: GenerationKind
  models: Array<GenerationConfigReadResponse['models'][number] & { kind: GenerationKind }>
} {
  return {
    kind: config.kind,
    models: config.models.map(model => ({ ...model, kind: config.kind })),
  }
}
