import { describe, expect, it } from 'vitest'
import { addReference, defaultGenerationContext, fallbackGenerationConfig } from '../src/generation.ts'
import {
  generationArtifacts,
  generationRefsFromEvent,
  generationRefsFromText,
  mergeGenerationArtifacts,
  mergeGenerationRefs,
  type GatewayEvent,
} from '../src/agent-session.ts'

describe('generation context', () => {
  it('uses image and video defaults', () => {
    expect(defaultGenerationContext('image').modelId).toBe(fallbackGenerationConfig.image.defaults.modelId)
    expect(defaultGenerationContext('video').parameters.duration).toBe(5)
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
