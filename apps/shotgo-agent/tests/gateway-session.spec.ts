import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SHOTGO_MOCK_MODEL, SHOTGO_MOCK_PROVIDER, ShotGoMockLlmAdapter } from '../src/llm/mock.ts'
import { HarnessGatewaySessionService } from '../src/gateway-session.ts'
import { LaravelGenerationConfigClient } from '../src/laravel/generation-config-client.ts'
import { LaravelGenerationQuoteClient } from '../src/laravel/generation-quote-client.ts'
import * as generationConfigRead from '../src/tools/generation-config-read.ts'
import * as runtime from '../src/runtime.ts'

const cleanup: Array<() => Promise<void>> = []
const mountTestPreset = (): Promise<void> => Promise.resolve()

function authorization(
  authorizationContextId: string,
  agentMode: 'canvas' | 'image' | 'video' = 'image',
) {
  return {
    authorizationContextId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    sessionId: 'test-session',
    userId: 2,
    teamId: 1,
    spaceId: 'space:1',
    projectId: 'project:1',
    agentMode,
    provider: SHOTGO_MOCK_PROVIDER,
    model: SHOTGO_MOCK_MODEL,
    maxTokens: 2_048,
  }
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map(dispose => dispose()))
})

describe('Gateway to Harness session composition', () => {
  it('accepts one Grant-bound browser decision for a pending generation approval', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const capabilities: string[] = []
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ sessionId, requiredCapability }) => {
        capabilities.push(requiredCapability)
        return { ...authorization('approval-context'), sessionId }
      },
    }, mountTestPreset)
    const events: SessionEvent[] = [{ type: 'turn/start' } as SessionEvent]
    const agent = {
      session: {
        id: 'approval-session',
        events,
        append(type: string, data: unknown) {
          const event = { type, data, seq: events.length, time: Date.now() } as SessionEvent
          events.push(event)
          return event
        },
      },
    } as unknown as Agent
    const live = {
      ...authorization('approval-context'),
      sessionId: 'approval-session',
      handle: { agent, dispose: () => Promise.resolve() },
      events: [],
      waiters: new Set(),
      capabilityGrant: { current: 'approval-grant' },
      nextCursor: 1,
      activeRunId: 'approval-run',
      disposed: false,
    }
    ;(service as unknown as { sessions: Map<string, unknown> }).sessions.set('approval-session', live)
    cleanup.push(async () => {
      await service.dispose()
      await ctx.fiber.dispose()
    })

    const decision = ctx.approval.request({
      agent,
      toolName: 'generation_submit',
      callId: CallId('generation-submit-call'),
      reason: '确认扣除 18 积分',
    })
    await Promise.resolve()
    const asked = events.find(event => event.type === 'approval/asked')
    if (asked?.type !== 'approval/asked') throw new Error('approval request was not audited')

    await service.respondToApproval({
      capabilityGrant: 'approval-grant',
      sessionId: 'approval-session',
      approvalId: asked.data.id,
      outcome: 'allowed-once',
    })

    await expect(decision).resolves.toBe('allowed-once')
    await expect(service.respondToApproval({
      capabilityGrant: 'approval-grant',
      sessionId: 'approval-session',
      approvalId: asked.data.id,
      outcome: 'allowed-once',
    })).resolves.toBeUndefined()
    await expect(service.respondToApproval({
      capabilityGrant: 'approval-grant',
      sessionId: 'approval-session',
      approvalId: asked.data.id,
      outcome: 'rejected',
    })).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_RESOLVED', status: 409 })
    expect(capabilities).toEqual([
      'agent.session.approval.respond',
      'agent.session.approval.respond',
      'agent.session.approval.respond',
    ])
  })

  it('streams a keyless Harness turn, replays by cursor, and deduplicates submission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shotgo-gateway-session-'))
    const previousRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
    process.env.SHOTGO_AGENT_SESSION_ROOT = root
    const ctx = new Context()
    await ctx.plugin(runtime)
    const requiredCapabilities: string[] = []
    const configRequests: Array<Record<string, unknown>> = []
    const quoteRequests: Array<Record<string, unknown>> = []
    const generationConfig = new LaravelGenerationConfigClient({
      baseURL: 'https://api.shotgo.cn',
      serviceToken: 'service-token',
      fetch: async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
        configRequests.push(JSON.parse(init.body) as Record<string, unknown>)
        return new Response(JSON.stringify({
          protocolVersion: '2026-08-25.1',
          parameterSchemaVersion: 1,
          authorizationContextId: 'team:1:user:2',
          sessionId: 'gateway-keyless-session',
          kind: 'image',
          models: [{ id: 'image-real', label: 'Image Real', credits: 18, vip: false }],
          parameters: {
            qualities: [{ id: 'standard', label: 'Standard' }],
            resolutions: [{ id: '2K', label: '2K' }],
            aspectRatios: [{ id: '16:9', label: '16:9' }],
            multiples: [{ id: '1', label: '1 image' }],
          },
          defaults: { modelId: 'image-real' },
        }), {
          status: 200,
          headers: {
            'Cache-Control': 'no-store, private',
            'X-ShotGo-Protocol-Version': '2026-08-25.1',
          },
        })
      },
    })
    const generationQuote = new LaravelGenerationQuoteClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
        quoteRequests.push({
          authorization: new Headers(init.headers).get('Authorization'),
          body: JSON.parse(init.body) as Record<string, unknown>,
        })
        return new Response(JSON.stringify({
          protocolVersion: '2026-08-25.1',
          quoteId: 'opaque-quote',
          quoteVersion: 1,
          kind: 'image',
          modelId: 'image-real',
          credits: 18,
          breakdown: [{ key: 'image-real', label: 'Image Real', credits: 18 }],
          canAfford: true,
          userBalance: 100,
          expiresAt: '2099-08-25T20:00:00+08:00',
          normalizedParameters: { kind: 'image', modelId: 'image-real', prompt: 'cat' },
          requiresConfirmation: true,
        }), { status: 200, headers: {
          'Cache-Control': 'no-store, private',
          'X-ShotGo-Protocol-Version': '2026-08-25.1',
        } })
      },
    })
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ capabilityGrant, sessionId, requiredCapability }) => {
        if (capabilityGrant !== 'grant-a' || sessionId !== 'gateway-keyless-session') throw new Error('denied')
        requiredCapabilities.push(requiredCapability)
        return { ...authorization('team:1:user:2'), sessionId }
      },
    }, async (agentCtx) => {
      generationConfigRead.apply(agentCtx)
    }, generationConfig, generationQuote)
    cleanup.push(async () => {
      await service.dispose()
      await ctx.fiber.dispose()
      if (previousRoot === undefined) delete process.env.SHOTGO_AGENT_SESSION_ROOT
      else process.env.SHOTGO_AGENT_SESSION_ROOT = previousRoot
      await rm(root, { recursive: true, force: true })
    })

    const input = {
      capabilityGrant: 'grant-a',
      sessionId: 'gateway-keyless-session',
      clientRequestId: 'client-request-0001',
      text: '我能使用哪些图片模型？',
    }
    const accepted = await service.submit(input)
    const duplicate = await service.submit(input)
    expect(duplicate).toEqual(accepted)
    await expect(service.submit({ ...input, capabilityGrant: 'invalid-grant' })).rejects.toThrow('denied')
    await expect(ctx.get('shotgoGenerationQuoteReader')?.quote({
      sessionId: input.sessionId,
      kind: 'image',
      modelId: 'image-real',
      parameters: { prompt: 'cat' },
    })).resolves.toMatchObject({ quoteId: 'opaque-quote', credits: 18 })
    expect(quoteRequests).toEqual([{
      authorization: 'Bearer grant-a',
      body: {
        sessionId: input.sessionId,
        kind: 'image',
        modelId: 'image-real',
        parameters: { prompt: 'cat' },
      },
    }])

    const events = []
    for await (const event of await service.events({
      capabilityGrant: 'grant-a',
      sessionId: input.sessionId,
      afterCursor: 0,
    })) events.push(event)

    expect(events.map(event => event.type)).toEqual([
      'run.accepted',
      ...events.filter(event => event.type === 'session.event').map(() => 'session.event' as const),
      'run.completed',
    ])
    const sessionTypes = events
      .filter(event => event.type === 'session.event')
      .map(event => event.payload.eventType)
    expect(sessionTypes).toContain('tool/call')
    expect(sessionTypes).toContain('tool/result')
    expect(sessionTypes).toContain('assistant/message')
    expect(JSON.stringify(events)).toContain('image-real')
    expect(JSON.stringify(events)).toContain('aspectRatios')
    expect(configRequests).toEqual([{
      grantToken: 'grant-a',
      sessionId: 'gateway-keyless-session',
      kind: 'image',
    }])

    const replay = []
    for await (const event of await service.events({
      capabilityGrant: 'grant-a',
      sessionId: input.sessionId,
      afterCursor: events.at(-2)?.cursor ?? 0,
    })) replay.push(event)
    expect(replay).toEqual([events.at(-1)])
    expect(requiredCapabilities).toEqual([
      'agent.session.submit',
      'agent.session.submit',
      'agent.session.events.read',
      'agent.session.events.read',
    ])
  })

  it('rejects another authorization context and a colliding context with different scope fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shotgo-gateway-access-'))
    const previousRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
    process.env.SHOTGO_AGENT_SESSION_ROOT = root
    const ctx = new Context()
    await ctx.plugin(runtime)
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ capabilityGrant, sessionId }) => capabilityGrant === 'same-context-other-project'
        ? { ...authorization('subject-a'), sessionId, projectId: 'project:2' }
        : { ...authorization(capabilityGrant), sessionId },
    }, mountTestPreset)
    cleanup.push(async () => {
      await service.dispose()
      await ctx.fiber.dispose()
      if (previousRoot === undefined) delete process.env.SHOTGO_AGENT_SESSION_ROOT
      else process.env.SHOTGO_AGENT_SESSION_ROOT = previousRoot
      await rm(root, { recursive: true, force: true })
    })

    await service.submit({
      capabilityGrant: 'subject-a',
      sessionId: 'private-session',
      clientRequestId: 'client-request-0002',
      text: 'hello',
    })
    const attempt = service.events({
      capabilityGrant: 'subject-b',
      sessionId: 'private-session',
      afterCursor: 0,
    })
    await expect(attempt).rejects.toMatchObject({ code: 'SESSION_ACCESS_DENIED', status: 403 })
    await expect(service.events({
      capabilityGrant: 'same-context-other-project',
      sessionId: 'private-session',
      afterCursor: 0,
    })).rejects.toMatchObject({ code: 'SESSION_ACCESS_DENIED', status: 403 })
  })

  it('cancels the active Harness turn and emits a terminal cancellation event', async () => {
    class CancellableAdapter extends ShotGoMockLlmAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: 'Cancellable keyless model' })
      }

      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted === true) resolve()
          else {
            options.signal?.addEventListener('abort', () => {
              resolve()
            }, { once: true })
          }
        })
        yield {
          type: 'finish',
          reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled by test user' } },
        }
      }
    }

    const root = await mkdtemp(join(tmpdir(), 'shotgo-gateway-cancel-'))
    const previousRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
    process.env.SHOTGO_AGENT_SESSION_ROOT = root
    const ctx = new Context()
    await ctx.plugin(runtime)
    ctx.llm.registerAdapter(['cancellable-keyless'], new CancellableAdapter())
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ sessionId }) => ({
        ...authorization('subject-cancel', 'video'),
        sessionId,
        provider: 'cancellable-keyless',
        model: 'cancellable-keyless',
      }),
    }, mountTestPreset)
    cleanup.push(async () => {
      await service.dispose()
      await ctx.fiber.dispose()
      if (previousRoot === undefined) delete process.env.SHOTGO_AGENT_SESSION_ROOT
      else process.env.SHOTGO_AGENT_SESSION_ROOT = previousRoot
      await rm(root, { recursive: true, force: true })
    })

    const accepted = await service.submit({
      capabilityGrant: 'subject-cancel',
      sessionId: 'cancel-session',
      clientRequestId: 'client-request-cancel',
      text: 'start a slow turn',
    })
    await service.cancel({
      capabilityGrant: 'subject-cancel',
      sessionId: 'cancel-session',
      runId: accepted.runId,
    })
    const events = []
    for await (const event of await service.events({
      capabilityGrant: 'subject-cancel',
      sessionId: 'cancel-session',
      afterCursor: 0,
    })) events.push(event)
    expect(events.at(-1)?.type).toBe('run.cancelled')
  })
})
