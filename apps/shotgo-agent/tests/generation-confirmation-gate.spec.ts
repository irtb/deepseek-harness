import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import * as confirmationGate from '../src/generation-confirmation-gate.ts'

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
  await ctx.plugin(confirmationGate)
  return ctx
}

describe('generation confirmation gate', () => {
  it('dispatches generation only after one explicit allowed-once response', async () => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('submitted'))
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
      arguments: { kind: 'image', modelId: 'image-real', credits: 18 },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(reason).toContain('image-real')
    expect(reason).toContain('18 积分')
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('fails closed on %s', async (outcome) => {
    const ctx = await mounted()
    const execute = vi.fn(() => Promise.resolve('must-not-run'))
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
      arguments: { kind: 'video', modelId: 'video-real', credits: 135 },
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
})
