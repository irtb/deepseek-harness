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
import { LaravelGenerationSubmitClient } from '../src/laravel/generation-submit-client.ts'
import { LaravelGenerationLifecycleClient } from '../src/laravel/generation-lifecycle-client.ts'
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
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(live.events).toContainEqual(expect.objectContaining({ type: 'approval.requested' }))
    const stream = (await service.events({
      capabilityGrant: 'approval-grant',
      sessionId: 'approval-session',
      afterCursor: 0,
    }))[Symbol.asyncIterator]()
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'approval.requested',
        runId: 'approval-run',
        payload: {
          approvalId: asked.data.id,
          toolName: 'generation_submit',
          callId: 'generation-submit-call',
          reason: '确认扣除 18 积分',
        },
      },
    })

    await service.respondToApproval({
      capabilityGrant: 'approval-grant-refreshed',
      sessionId: 'approval-session',
      approvalId: asked.data.id,
      outcome: 'allowed-once',
    })

    await expect(decision).resolves.toBe('allowed-once')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(live.events).toContainEqual(expect.objectContaining({ type: 'approval.resolved' }))
    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'approval.resolved',
        runId: 'approval-run',
        payload: { approvalId: asked.data.id, outcome: 'allowed-once' },
      },
    })
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
    expect(live.capabilityGrant.current).toBe('approval-grant-refreshed')
    expect(capabilities).toEqual([
      'agent.session.events.read',
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
    const submitRequests: Array<Record<string, unknown>> = []
    const lifecycleRequests: Array<Record<string, unknown>> = []
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
    const generationSubmit = new LaravelGenerationSubmitClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
        const headers = new Headers(init.headers)
        submitRequests.push({
          authorization: headers.get('Authorization'),
          idempotencyKey: headers.get('Idempotency-Key'),
          body: JSON.parse(init.body) as Record<string, unknown>,
        })
        return new Response(JSON.stringify({
          protocolVersion: '2026-08-25.1',
          generationId: 'generation-1',
          clientRequestId: headers.get('Idempotency-Key'),
          operationId: 'generation-1',
          state: 'queued',
          stage: 'queued',
          credits: 18,
          userBalance: 82,
          replayed: false,
          createdAt: '2026-08-25T20:00:00+08:00',
          updatedAt: '2026-08-25T20:00:00+08:00',
        }), { status: 202, headers: {
          'Cache-Control': 'no-store, private',
          'X-ShotGo-Protocol-Version': '2026-08-25.1',
        } })
      },
    })
    const generationLifecycle = new LaravelGenerationLifecycleClient({
      baseURL: 'https://api.shotgo.cn',
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers)
        lifecycleRequests.push({
          url: url instanceof URL ? url.href : typeof url === 'string' ? url : url.url,
          method: init?.method,
          authorization: headers.get('Authorization'),
          idempotencyKey: headers.get('Idempotency-Key'),
          body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null,
        })
        return new Response(JSON.stringify({
          protocolVersion: '2026-08-25.1',
          generationId: 'generation-1',
          clientRequestId: 'generation-request',
          operationId: 'generation-1',
          state: init?.method === 'POST' ? 'cancelled' : 'processing',
          stage: init?.method === 'POST' ? 'cancelled' : 'processing',
          credits: 18,
          userBalance: 82,
          replayed: false,
          createdAt: '2026-08-25T20:00:00+08:00',
          updatedAt: '2026-08-25T20:01:00+08:00',
        }), { status: 200, headers: { 'X-ShotGo-Protocol-Version': '2026-08-25.1' } })
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
    }, generationConfig, generationQuote, generationSubmit, generationLifecycle)
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
      generationContext: {
        schemaVersion: 1 as const,
        kind: 'image' as const,
        modelId: 'image-real',
        parameters: {
          aspectRatioId: '16:9',
          resolutionId: '2K',
          referenceAssets: [{ mediaLibraryItemId: 41 }, { mediaLibraryItemId: 42 }],
        },
      },
    }
    const accepted = await service.submit(input)
    const duplicate = await service.submit(input)
    expect(duplicate).toEqual(accepted)
    await expect(service.submit({
      ...input,
      text: '使用相同幂等键但改变提示词',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    await expect(service.submit({ ...input, capabilityGrant: 'invalid-grant' })).rejects.toThrow('denied')
    await expect(ctx.get('shotgoGenerationQuoteReader')?.quote({
      sessionId: input.sessionId,
      kind: 'image',
      modelId: 'image-real',
      parameters: {
        prompt: 'cat',
        qualityId: 'model-injected',
        referenceAssets: [{ mediaLibraryItemId: 999 }],
      },
    })).resolves.toMatchObject({ quoteId: 'opaque-quote', credits: 18 })
    expect(quoteRequests).toEqual([{
      authorization: 'Bearer grant-a',
      body: {
        sessionId: input.sessionId,
        kind: 'image',
        modelId: 'image-real',
        parameters: {
          prompt: 'cat',
          aspectRatioId: '16:9',
          resolutionId: '2K',
          referenceAssets: [{ mediaLibraryItemId: 41 }, { mediaLibraryItemId: 42 }],
        },
      },
    }])
    await expect(ctx.get('shotgoGenerationSubmitter')?.submit({
      sessionId: input.sessionId,
      actionId: 'generation-submit-call',
      quoteId: 'opaque-quote',
      quoteVersion: 1,
    })).resolves.toMatchObject({ generationId: 'generation-1', state: 'queued' })
    const generatedIdempotencyKey = submitRequests[0]?.idempotencyKey
    expect(generatedIdempotencyKey).toMatch(/^gen-[a-f0-9]{60}$/)
    expect(submitRequests).toEqual([{
      authorization: 'Bearer grant-a',
      idempotencyKey: generatedIdempotencyKey,
      body: {
        context: {
          sessionId: input.sessionId,
          runId: accepted.runId,
          actionId: 'generation-submit-call',
          clientRequestId: generatedIdempotencyKey,
        },
        quoteId: 'opaque-quote',
        quoteVersion: 1,
      },
    }])
    await expect(ctx.get('shotgoGenerationLifecycle')?.read({
      sessionId: input.sessionId,
      generationId: 'generation-1',
    })).resolves.toMatchObject({ state: 'processing' })
    await expect(ctx.get('shotgoGenerationLifecycle')?.cancel({
      sessionId: input.sessionId,
      actionId: 'generation-cancel-call',
      generationId: 'generation-1',
    })).resolves.toMatchObject({ state: 'cancelled' })
    const cancellationKey = lifecycleRequests[1]?.idempotencyKey
    expect(cancellationKey).toMatch(/^cancel-[a-f0-9]{57}$/)
    expect(lifecycleRequests).toEqual([{
      url: 'https://api.shotgo.cn/api/agent/v1/generations/generation-1',
      method: 'GET',
      authorization: 'Bearer grant-a',
      idempotencyKey: null,
      body: null,
    }, {
      url: 'https://api.shotgo.cn/api/agent/v1/generations/generation-1/cancel',
      method: 'POST',
      authorization: 'Bearer grant-a',
      idempotencyKey: cancellationKey,
      body: {
        context: {
          sessionId: input.sessionId,
          runId: accepted.runId,
          actionId: 'generation-cancel-call',
          clientRequestId: cancellationKey,
        },
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
