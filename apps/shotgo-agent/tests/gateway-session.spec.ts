import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SHOTGO_MOCK_MODEL, SHOTGO_MOCK_PROVIDER, ShotGoMockLlmAdapter } from '../src/llm/mock.ts'
import { HarnessGatewaySessionService } from '../src/gateway-session.ts'
import * as runtime from '../src/runtime.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map(dispose => dispose()))
})

describe('Gateway to Harness session composition', () => {
  it('streams a keyless Harness turn, replays by cursor, and deduplicates submission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shotgo-gateway-session-'))
    const previousRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
    process.env.SHOTGO_AGENT_SESSION_ROOT = root
    const ctx = new Context()
    await ctx.plugin(runtime)
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ capabilityGrant, sessionId }) => {
        if (capabilityGrant !== 'grant-a' || sessionId !== 'gateway-keyless-session') throw new Error('denied')
        return {
          subjectId: 'team:1:user:2',
          agentMode: 'image',
          provider: SHOTGO_MOCK_PROVIDER,
          model: SHOTGO_MOCK_MODEL,
          maxTokens: 2_048,
        }
      },
    })
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

    const replay = []
    for await (const event of await service.events({
      capabilityGrant: 'grant-a',
      sessionId: input.sessionId,
      afterCursor: events.at(-2)?.cursor ?? 0,
    })) replay.push(event)
    expect(replay).toEqual([events.at(-1)])
  })

  it('keeps one capability subject from reading another subject session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shotgo-gateway-access-'))
    const previousRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
    process.env.SHOTGO_AGENT_SESSION_ROOT = root
    const ctx = new Context()
    await ctx.plugin(runtime)
    const service = new HarnessGatewaySessionService(ctx, {
      authorize: async ({ capabilityGrant }) => ({
        subjectId: capabilityGrant,
        agentMode: 'image',
        provider: SHOTGO_MOCK_PROVIDER,
        model: SHOTGO_MOCK_MODEL,
        maxTokens: 2_048,
      }),
    })
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
      authorize: async () => ({
        subjectId: 'subject-cancel',
        agentMode: 'video',
        provider: 'cancellable-keyless',
        model: 'cancellable-keyless',
        maxTokens: 2_048,
      }),
    })
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
