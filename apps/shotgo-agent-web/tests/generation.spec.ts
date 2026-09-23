import { describe, expect, it } from 'vitest'
import {
  addReference,
  defaultGenerationContext,
  durationOptions,
  fallbackGenerationConfig,
  firstSupportedOptionId,
  normalizeGenerationContext,
  optionSupport,
  optionsForModel,
  updateGenerationContext,
  type GenerationConfig,
} from '../src/generation.ts'
import {
  generationArtifacts,
  generationRefsFromEvent,
  generationRefsFromText,
  mergeGenerationArtifacts,
  mergeGenerationRefs,
  type GatewayEvent,
} from '../src/agent-session.ts'

const coupledConfig: GenerationConfig = {
  image: {
    models: [
      {
        id: 'doubao-seedream-5-0-lite',
        label: 'Doubao Seedream 5.0 lite',
        supportedOptions: {
          resolution: ['2K', '3K', '4K'],
          aspect_ratio: ['auto', '1:1', '16:9'],
        },
      },
      {
        id: 'gemini-3.1-flash-image',
        label: 'Gemini 3.1 Flash Image',
        supportedOptions: {
          resolution: ['1K', '2K'],
          aspect_ratio: ['1:1', '16:9', '9:16'],
        },
      },
      { id: 'unrestricted-model', label: 'Unrestricted' },
    ],
    qualities: [
      { id: 'standard', label: '标准画质' },
      { id: 'high', label: '高清' },
    ],
    resolutions: [
      { id: '1K', label: '1K' },
      { id: '2K', label: '2K' },
      { id: '3K', label: '3K' },
      { id: '4K', label: '4K' },
    ],
    aspectRatios: [
      { id: 'auto', label: '自适应' },
      { id: '1:1', label: '1:1' },
      { id: '16:9', label: '16:9' },
      { id: '9:16', label: '9:16' },
    ],
    defaults: {
      modelId: 'doubao-seedream-5-0-lite',
      qualityId: 'standard',
      resolutionId: '2K',
      aspectRatioId: 'auto',
    },
  },
  video: fallbackGenerationConfig.video,
}

describe('model option coupling', () => {
  it('treats missing supportedOptions as unrestricted and empty group as none', () => {
    const gemini = coupledConfig.image.models.find(m => m.id === 'gemini-3.1-flash-image')
    const open = coupledConfig.image.models.find(m => m.id === 'unrestricted-model')
    expect(optionSupport(open, 'aspect_ratio')).toBe('unrestricted')
    expect(optionSupport(gemini, 'quality')).toBe('unrestricted')
    expect(optionSupport({ id: 'x', label: 'x', supportedOptions: { aspect_ratio: [] } }, 'aspect_ratio')).toBe('none')
    expect(optionSupport(gemini, 'aspect_ratio')).toEqual(['1:1', '16:9', '9:16'])
  })

  it('filters aspect ratios for Gemini and keeps auto for Seedream', () => {
    const gemini = coupledConfig.image.models.find(m => m.id === 'gemini-3.1-flash-image')
    const seedream = coupledConfig.image.models.find(m => m.id === 'doubao-seedream-5-0-lite')
    expect(optionsForModel(coupledConfig.image.aspectRatios, gemini, 'aspect_ratio').map(o => o.id)).toEqual([
      '1:1', '16:9', '9:16',
    ])
    expect(optionsForModel(coupledConfig.image.aspectRatios, seedream, 'aspect_ratio').map(o => o.id)).toContain('auto')
  })

  it('switches Gemini away from auto to first supported ratio', () => {
    const previous = normalizeGenerationContext('image', coupledConfig, {
      schemaVersion: 1,
      kind: 'image',
      modelId: 'doubao-seedream-5-0-lite',
      parameters: { qualityId: 'standard', resolutionId: '2K', aspectRatioId: 'auto' },
    })
    const next = updateGenerationContext(previous, { modelId: 'gemini-3.1-flash-image' }, coupledConfig)
    expect(next.modelId).toBe('gemini-3.1-flash-image')
    expect(next.parameters.aspectRatioId).toBe('1:1')
    expect(next.parameters.resolutionId).toBe('2K')
  })

  it('preserves compatible aspect ratio when switching back to Seedream', () => {
    const gemini = normalizeGenerationContext('image', coupledConfig, {
      schemaVersion: 1,
      kind: 'image',
      modelId: 'gemini-3.1-flash-image',
      parameters: { qualityId: 'standard', resolutionId: '2K', aspectRatioId: '1:1' },
    })
    const next = updateGenerationContext(gemini, { modelId: 'doubao-seedream-5-0-lite' }, coupledConfig)
    expect(next.parameters.aspectRatioId).toBe('1:1')
  })

  it('removes parameter when group is explicitly empty', () => {
    const config: GenerationConfig = {
      ...coupledConfig,
      image: {
        ...coupledConfig.image,
        models: [{
          id: 'no-quality',
          label: 'No quality',
          supportedOptions: { quality: [], resolution: ['2K'], aspect_ratio: ['1:1'] },
        }],
        defaults: { modelId: 'no-quality', qualityId: 'standard', resolutionId: '2K', aspectRatioId: '1:1' },
      },
    }
    const ctx = normalizeGenerationContext('image', config)
    expect(ctx.parameters.qualityId).toBeUndefined()
    expect(ctx.parameters.aspectRatioId).toBe('1:1')
    expect(firstSupportedOptionId(config.image.qualities, config.image.models[0], 'quality')).toBeUndefined()
  })
})

describe('generation context', () => {
  it('uses image and video defaults', () => {
    expect(defaultGenerationContext('image').modelId).toBe(fallbackGenerationConfig.image.defaults.modelId)
    expect(defaultGenerationContext('video').parameters.duration).toBe(5)
  })

  it('clamps video duration into the configured range', () => {
    const next = updateGenerationContext(
      defaultGenerationContext('video'),
      { parameters: { duration: 99 } },
      fallbackGenerationConfig,
    )
    expect(next.parameters.duration).toBe(fallbackGenerationConfig.video.duration.max)
  })

  it('builds discrete duration options for the chip select', () => {
    expect(durationOptions({ min: 4, max: 6, step: 1, default: 5 }).map(item => item.id)).toEqual(['4', '5', '6'])
  })

  it('deduplicates and caps references', () => {
    let context = defaultGenerationContext('image')
    for (let id = 1; id <= 12; id += 1) context = addReference(context, id)
    context = addReference(context, 1)
    expect(context.parameters.referenceAssets).toHaveLength(9)
  })

  it('attaches references on video context', () => {
    const context = addReference(defaultGenerationContext('video'), 51)
    expect(context.kind).toBe('video')
    expect(context.parameters.referenceAssets).toEqual([{ mediaLibraryItemId: 51 }])
  })
})

it('projects authoritative artifact events', () => {
  const event = { type: 'session.event', payload: { artifacts: [{ id: 'a1', mediaType: 'image', status: 'succeeded', url: 'https://example.test/a.png' }] } } as unknown as GatewayEvent
  expect(generationArtifacts(event)?.[0]?.url).toContain('a.png')
})

it('extracts generationId and clientRequestId from tool-result payloads', () => {
  const event = {
    type: 'session.event',
    payload: {
      event: {
        type: 'tool/result',
        data: {
          message: {
            content: [{
              type: 'tool-result',
              content: [{
                type: 'text',
                text: JSON.stringify({
                  generationId: '701',
                  clientRequestId: 'gen-dcc943801c6d60646f602405aabd96206a3b444b0266bf3538f1b9f02ab0',
                  state: 'failed',
                }),
              }],
            }],
          },
        },
      },
    },
  } as unknown as GatewayEvent
  expect(generationRefsFromEvent(event)).toEqual([{
    generationId: '701',
    clientRequestId: 'gen-dcc943801c6d60646f602405aabd96206a3b444b0266bf3538f1b9f02ab0',
    state: 'failed',
  }])
})

it('merges generation refs and parses assistant text fallback', () => {
  expect(mergeGenerationRefs(
    [{ generationId: '700', clientRequestId: 'gen-a' }],
    [{ generationId: '701', clientRequestId: 'gen-b', state: 'failed' }],
  )).toEqual([
    { generationId: '700', clientRequestId: 'gen-a' },
    { generationId: '701', clientRequestId: 'gen-b', state: 'failed' },
  ])
  expect(generationRefsFromText([
    '生成任务编号 | **701**',
    '客户端请求号 | `gen-dcc943801c6d60646f602405aabd96206a3b444b0266bf3538f1b9f02ab0`',
  ].join('\n'))).toEqual([{
    generationId: '701',
    clientRequestId: 'gen-dcc943801c6d60646f602405aabd96206a3b444b0266bf3538f1b9f02ab0',
  }])
})

it('accumulates multi-generation artifacts instead of replacing', () => {
  expect(mergeGenerationArtifacts(
    [{ id: '706:1', mediaType: 'image', status: 'succeeded', url: 'https://cdn/a.png' }],
    [{ id: '707:2', mediaType: 'image', status: 'processing' }],
  )).toEqual([
    { id: '706:1', mediaType: 'image', status: 'succeeded', url: 'https://cdn/a.png' },
    { id: '707:2', mediaType: 'image', status: 'processing' },
  ])
})
