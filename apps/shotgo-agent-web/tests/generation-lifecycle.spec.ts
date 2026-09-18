import { describe, expect, it } from 'vitest'
import {
  artifactBelongsToGeneration,
  isGenerationRenderSettled,
  needsLifecyclePoll,
} from '../src/generation-lifecycle.ts'
import { artifactsForMessage, statusLabel } from '../src/message-artifacts.ts'
import { generationRefsFromText } from '../src/agent-session.ts'
import type { AgentMessage } from '../src/agent-session.ts'

describe('needsLifecyclePoll', () => {
  it('polls when artifacts are missing', () => {
    expect(needsLifecyclePoll(undefined)).toBe(true)
    expect(needsLifecyclePoll([])).toBe(true)
  })

  it('polls while queued or processing or succeeded without url', () => {
    expect(needsLifecyclePoll([{ id: '1', mediaType: 'image', status: 'queued' }])).toBe(true)
    expect(needsLifecyclePoll([{ id: '1', mediaType: 'image', status: 'processing' }])).toBe(true)
    expect(needsLifecyclePoll([{ id: '1', mediaType: 'image', status: 'succeeded' }])).toBe(true)
  })

  it('stops when succeeded with url or failed', () => {
    expect(needsLifecyclePoll([{ id: '1', mediaType: 'image', status: 'succeeded', url: 'https://cdn.example/a.png' }])).toBe(false)
    expect(needsLifecyclePoll([{ id: '1', mediaType: 'image', status: 'failed' }])).toBe(false)
  })
})

describe('generation artifact identity', () => {
  it('binds asset ids to generation ids', () => {
    expect(artifactBelongsToGeneration('703:700', '703')).toBe(true)
    expect(artifactBelongsToGeneration('700', '703')).toBe(false)
    expect(artifactBelongsToGeneration('703', '703')).toBe(true)
  })

  it('settles after completed assets are renderable (gen-658d / 703 regression)', () => {
    expect(
      isGenerationRenderSettled(
        [{ id: '703:700', mediaType: 'image', status: 'succeeded', url: 'http://res.tokenhub.video/dev/a.png' }],
        '703',
        'completed',
      ),
    ).toBe(true)
    expect(
      isGenerationRenderSettled(
        [{ id: '700', mediaType: 'image', status: 'succeeded', url: 'http://res.tokenhub.video/dev/a.png' }],
        '703',
        'completed',
      ),
    ).toBe(true)
    expect(
      isGenerationRenderSettled(
        [{ id: '703', mediaType: 'image', status: 'processing' }],
        '703',
        'processing',
      ),
    ).toBe(false)
  })
})

describe('artifactsForMessage', () => {
  it('synthesizes processing placeholders from generationRefs (704 gap)', () => {
    const message: AgentMessage = {
      id: 'a1',
      role: 'assistant',
      text: '提交成功',
      status: 'complete',
      generationRefs: [{ generationId: '704', clientRequestId: 'gen-8fd336d3d73eae60d86e923eb9199f0dfbdd5d1f801bf5808ba84c9ca8ed', state: 'processing' }],
    }
    const cards = artifactsForMessage(message, 'image')
    expect(cards).toEqual([{ id: '704', mediaType: 'image', status: 'processing' }])
  })

  it('keeps real assets and only fills missing refs', () => {
    const message: AgentMessage = {
      id: 'a1',
      role: 'assistant',
      text: '',
      status: 'complete',
      generationRefs: [
        { generationId: '704', clientRequestId: 'gen-a' },
        { generationId: '705', clientRequestId: 'gen-b' },
      ],
      artifacts: [{ id: '704:701', mediaType: 'image', status: 'succeeded', url: 'http://cdn/x.jpg' }],
    }
    const cards = artifactsForMessage(message, 'image')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.id).toBe('704:701')
    expect(cards[1]).toEqual({ id: '705', mediaType: 'image', status: 'processing' })
  })

  it('parses generation id from assistant markdown table text', () => {
    const text = '| 生成任务编号 | **704** |\n| 客户端请求号 | `gen-8fd336d3d73eae60` |'
    expect(generationRefsFromText(text)).toEqual([
      { generationId: '704', clientRequestId: 'gen-8fd336d3d73eae60' },
    ])
  })

  it('parses multiple generation refs and OUTCOME_UNKNOWN clientRequestId', () => {
    const text = [
      '生成任务编号 | **706**',
      '客户端请求号 | `gen-aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666777788889999`',
      '生成任务编号 | **707**',
      '客户端请求号 | `gen-bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000aaaa`',
      'Error: GENERATION_OUTCOME_UNKNOWN clientRequestId=gen-cccc3333dddd4444eeee5555ffff66667777888899990000aaaabbbb1111',
    ].join('\n')
    expect(generationRefsFromText(text)).toEqual([
      {
        generationId: 'gen-cccc3333dddd4444eeee5555ffff66667777888899990000aaaabbbb1111',
        clientRequestId: 'gen-cccc3333dddd4444eeee5555ffff66667777888899990000aaaabbbb1111',
        state: 'reconciling',
      },
      {
        generationId: '706',
        clientRequestId: 'gen-aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666777788889999',
      },
      {
        generationId: '707',
        clientRequestId: 'gen-bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000aaaa',
      },
    ])
  })
})

describe('statusLabel', () => {
  it('uses Chinese labels', () => {
    expect(statusLabel('queued')).toBe('排队中')
    expect(statusLabel('processing')).toBe('生成中')
    expect(statusLabel('succeeded')).toBe('已完成')
    expect(statusLabel('failed')).toBe('失败')
    expect(statusLabel('failed', '未创建')).toBe('未创建')
    expect(statusLabel('processing', '核对中')).toBe('核对中')
  })
})
