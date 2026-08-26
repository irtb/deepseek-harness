/** Read-only Phase 0A generation-model catalog tool. */

import type { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  GenerationConfigModel,
  GenerationConfigReadResponse,
  GenerationKind,
} from '../contracts/laravel-v1.ts'
import type {} from '../generation-config.ts'

const MOCK_IMAGE_MODEL = Object.freeze({
  id: 'shotgo-image-mock',
  label: 'ShotGo Image Mock',
  vip: false,
  kind: 'image' as const,
})

const MOCK_VIDEO_MODEL = Object.freeze({
  id: 'shotgo-video-mock',
  label: 'ShotGo Video Mock',
  vip: false,
  kind: 'video' as const,
})

interface ToolModel {
  id: string
  label: string
  kind: GenerationKind
  vip: boolean
  shortLabel?: string
  badge?: string
  duration?: string
  description?: string
  credits?: number
  supportedOptions?: JsonValue
  optionOverrides?: JsonValue
  operationOptionConstraints?: JsonValue
  durationRange?: Record<string, JsonValue>
  fpsEnabled?: boolean
  fpsRanges?: Array<Record<string, JsonValue>>
}

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
          parameterSchemaVersion: { type: 'number', required: true, const: 1 },
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
                vip: { type: 'boolean', required: true },
                shortLabel: { type: 'string' },
                badge: { type: 'string' },
                duration: { type: 'string' },
                description: { type: 'string' },
                credits: { type: 'number' },
                supportedOptions: { type: 'json' },
                optionOverrides: { type: 'json' },
                operationOptionConstraints: { type: 'json' },
                durationRange: { type: 'object', additionalProperties: true },
                fpsEnabled: { type: 'boolean' },
                fpsRanges: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
          parameters: { type: 'object', required: true, additionalProperties: true },
          defaults: { type: 'object', required: true, additionalProperties: true },
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
        ? {
          kind: 'image' as const,
          parameterSchemaVersion: 1 as const,
          models: [MOCK_IMAGE_MODEL],
          parameters: { qualities: [], resolutions: [], aspectRatios: [] },
          defaults: { modelId: MOCK_IMAGE_MODEL.id },
        }
        : {
          kind: 'video' as const,
          parameterSchemaVersion: 1 as const,
          models: [MOCK_VIDEO_MODEL],
          parameters: {
            aspectRatios: [],
            resolutions: [],
            duration: {},
            fps: {},
            audioOptions: [],
            operationTypes: [],
          },
          defaults: { modelId: MOCK_VIDEO_MODEL.id },
        }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.kind === 'image' ? '读取图片模型配置' : '读取视频模型配置',
      kind: 'read',
    }),
  }))
}

function toolResult(config: GenerationConfigReadResponse) {
  return {
    kind: config.kind,
    parameterSchemaVersion: config.parameterSchemaVersion,
    models: config.models.map(model => toolModel(model, config.kind)),
    parameters: jsonObject(config.parameters),
    defaults: jsonObject(config.defaults),
  }
}

function toolModel(model: GenerationConfigModel, kind: GenerationKind): ToolModel {
  const result: ToolModel = { id: model.id, label: model.label, kind, vip: model.vip }
  if (model.shortLabel !== undefined) result.shortLabel = model.shortLabel
  if (model.badge !== undefined) result.badge = model.badge
  if (model.duration !== undefined) result.duration = model.duration
  if (model.description !== undefined) result.description = model.description
  if (model.credits !== undefined) result.credits = model.credits
  if (model.supportedOptions !== undefined) result.supportedOptions = jsonValue(model.supportedOptions)
  if (model.optionOverrides !== undefined) result.optionOverrides = jsonValue(model.optionOverrides)
  if (model.operationOptionConstraints !== undefined) {
    result.operationOptionConstraints = jsonValue(model.operationOptionConstraints)
  }
  if (model.durationRange !== undefined) result.durationRange = jsonObject(model.durationRange)
  if (model.fpsEnabled !== undefined) result.fpsEnabled = model.fpsEnabled
  if (model.fpsRanges !== undefined) result.fpsRanges = model.fpsRanges.map(jsonObject)
  return result
}

function jsonObject(value: object): Record<string, JsonValue> {
  const snapshot = jsonValue(value)
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('GENERATION_CONFIG_JSON_OBJECT_REQUIRED')
  }
  return snapshot
}

function jsonValue(value: object): JsonValue {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('GENERATION_CONFIG_JSON_VALUE_REQUIRED')
  return snapshot as JsonValue
}
