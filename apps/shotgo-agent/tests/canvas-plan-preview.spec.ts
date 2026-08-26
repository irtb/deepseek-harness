import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as canvasPlanPreview from '../src/tools/canvas-plan-preview.ts'

function agent(): Agent {
  return { session: { id: 'canvas-plan-session' } } as unknown as Agent
}

async function execute(argumentsValue: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(canvasPlanPreview)
  return ctx.tools.execute({
    agent: agent(),
    callId: CallId('canvas-plan-call'),
    name: 'canvas_plan_preview',
    arguments: argumentsValue,
    signal: new AbortController().signal,
  })
}

const validPlan = {
  summary: '先生成主视觉，再生成短视频。',
  nodes: [
    { tempId: 'image-1', name: '主视觉', kind: 'image' },
    { tempId: 'video-1', name: '短视频', kind: 'video' },
  ],
  dependencies: [{ from: 'image-1', to: 'video-1' }],
  modelId: 'deepseek-v4-flash',
  estimatedCredits: 8,
}

describe('canvas_plan_preview', () => {
  it('returns a bounded read-only plan', async () => {
    const result = await execute(validPlan)
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('"requiresConfirmation":true')
  })

  it.each([
    ['blank summary', { ...validPlan, summary: '   ' }],
    ['empty nodes', { ...validPlan, nodes: [], dependencies: [] }],
    ['duplicate node ids', { ...validPlan, nodes: [validPlan.nodes[0], validPlan.nodes[0]], dependencies: [] }],
    ['self edge', { ...validPlan, dependencies: [{ from: 'image-1', to: 'image-1' }] }],
    ['duplicate edges', { ...validPlan, dependencies: [validPlan.dependencies[0], validPlan.dependencies[0]] }],
    ['oversized model id', { ...validPlan, modelId: 'm'.repeat(129) }],
  ])('rejects %s', async (_label, input) => {
    expect((await execute(input)).isError).toBe(true)
  })
})
