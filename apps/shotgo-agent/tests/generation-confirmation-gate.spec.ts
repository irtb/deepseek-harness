import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as confirmationGate from '../src/generation-confirmation-gate.ts'
import * as quoteRegistry from '../src/generation-quote-registry.ts'
import * as canvasPlanQuoteRegistry from '../src/canvas-plan-quote-registry.ts'

function activeAgent(): Agent {
  const events: SessionEvent[] = [{ type: 'turn/start' } as SessionEvent]
  return {
    session: {
      id: 'confirmation-session',
      events,
      append(type: string, data: unknown) {
        const event = { type, data, seq: events.length, time: Date.now() } as SessionEvent
        events.push(event)
        return event
      },
    },
  } as unknown as Agent
}

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(quoteRegistry)
  await ctx.plugin(canvasPlanQuoteRegistry)
  await ctx.plugin(confirmationGate)
  return ctx
}

function recordQuote(ctx: Context, quoteId = 'quote-real'): void {
  ctx.shotgoGenerationQuoteRegistry.record('confirmation-session', {
    protocolVersion: '2026-08-25.1',
    quoteId,
    quoteVersion: 1,
    kind: 'image',
    modelId: 'image-real',
    credits: 18,
    breakdown: [{ key: 'model', label: 'Image Real', credits: 18 }],
    canAfford: true,
    userBalance: 100,
    expiresAt: '2099-01-01T00:00:00.000Z',
    normalizedParameters: { prompt: 'cat', aspectRatioId: '16:9' },
    requiresConfirmation: true,
  })
}

describe('generation confirmation gate', () => {
  it('dispatches generation only after one explicit allowed-once response', async () => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('submitted'))
    recordQuote(ctx)
    ctx.tools.register(defineTool({
      name: 'generation_submit',
      description: 'test submission',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute,
    }))
    let reason = ''
    ctx.on('approval/request', (request) => {
      reason = request.reason ?? ''
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    const result = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId('generation-call'),
      name: 'generation_submit',
      arguments: { quoteId: 'quote-real', quoteVersion: 1, kind: 'video', modelId: 'fake', credits: 1 },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(reason).toBe('确认使用 image-real 生成图片，将扣除 18 积分。提示词：cat。设置：{"aspectRatioId":"16:9"}。批准仅对本次工具调用有效。')

    const replay = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId('generation-call-replay'),
      name: 'generation_submit',
      arguments: { quoteId: 'quote-real', quoteVersion: 1 },
      signal: new AbortController().signal,
    })
    expect(replay.isError).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('fails closed on %s', async (outcome) => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('must-not-run'))
    recordQuote(ctx)
    ctx.tools.register(defineTool({
      name: 'generation_submit',
      description: 'test submission',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute,
    }))
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>(outcome))

    const result = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId(`generation-${outcome}`),
      name: 'generation_submit',
      arguments: { quoteId: 'quote-real', quoteVersion: 1 },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not prompt for read-only tools', async () => {
    const ctx = await mounted()
    const prompted = vi.fn()
    ctx.on('approval/request', () => {
      prompted()
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    ctx.tools.register(defineTool({
      name: 'generation_quote',
      description: 'test quote',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('quoted'),
    }))

    const result = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId('quote-call'),
      name: 'generation_quote',
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(prompted).not.toHaveBeenCalled()
  })

  it('fails closed when the authoritative quote is missing', async () => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('must-not-run'))
    ctx.tools.register(defineTool({
      name: 'generation_submit',
      description: 'test submission',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute,
    }))
    const result = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId('missing-quote'),
      name: 'generation_submit',
      arguments: { quoteId: 'missing', quoteVersion: 1 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('GENERATION_QUOTE_REFRESH_REQUIRED')
    expect(JSON.stringify(result)).toContain('Call generation_quote again')
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires one-shot approval before cancellation', async () => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('cancelled'))
    ctx.tools.register(defineTool({
      name: 'generation_cancel',
      description: 'test cancellation',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute,
    }))
    let reason = ''
    ctx.on('approval/request', (request) => {
      reason = request.reason ?? ''
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    const result = await ctx.tools.execute({
      agent: activeAgent(),
      callId: CallId('cancel-call'),
      name: 'generation_cancel',
      arguments: { generationId: '42' },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(reason).toContain('42')
  })

  it('uses only the authoritative Canvas plan quote in the one-shot approval reason', async () => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('applied'))
    ctx.shotgoCanvasPlanQuoteRegistry.record('confirmation-session', {
      protocolVersion: '2026-08-26.1', quoteId: 'canvas-quote', quoteVersion: 1,
      quoteKind: 'canvas-plan', authorizationContextId: 'auth', sessionId: 'confirmation-session',
      userId: 1, teamId: null, spaceId: 'space', projectId: 'project', planId: 'plan', revision: 'r'.repeat(32),
      summary: '新增文案与主视觉',
      nodes: [
        { tempId: 'copy', nodeKey: 'node-copy', name: '文案', kind: 'text' },
        { tempId: 'hero', nodeKey: 'node-hero', name: '主视觉', kind: 'image' },
      ],
      dependencies: [{ from: 'copy', to: 'hero', connectionKey: 'edge', sourceKey: 'node-copy', targetKey: 'node-hero' }],
      credits: 1, billingMode: 'virtual', expiresAt: '2099-01-01T00:00:00.000Z', requiresConfirmation: true,
    })
    ctx.tools.register(defineTool({
      name: 'canvas_ops_apply', description: 'test Canvas apply', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute,
    }))
    let reason = ''
    ctx.on('approval/request', (request) => { reason = request.reason ?? ''; return Promise.resolve<ApprovalOutcome>('allowed-once') })

    const result = await ctx.tools.execute({
      agent: activeAgent(), callId: CallId('canvas-apply'), name: 'canvas_ops_apply',
      arguments: { quoteId: 'canvas-quote', quoteVersion: 1, summary: '伪造计划', credits: 999 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(reason).toBe('确认在当前画布新增 2 个节点和 1 条连线。计划：新增文案与主视觉。本次显示 1 个 Agent 虚拟积分，不实际扣费。批准仅对这份 Laravel 冻结计划有效。')
  })
})
