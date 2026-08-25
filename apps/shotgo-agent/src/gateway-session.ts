import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentMode } from './contracts/laravel-v1.ts'
import {
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  type GatewayStreamEvent,
} from './contracts/gateway-v1.ts'
import { GatewaySessionError } from './gateway-errors.ts'
import type {
  GatewaySessionAccess,
  GatewaySessionCancel,
  GatewaySessionService,
  GatewaySessionSubmit,
} from './gateway-transport.ts'

export interface AuthorizedGatewaySession {
  subjectId: string
  agentMode: AgentMode
  provider: string
  model: string
  maxTokens: number
}

export interface GatewaySessionAuthorizer {
  authorize(input: {
    capabilityGrant: string
    sessionId: string
    signal?: AbortSignal
  }): Promise<AuthorizedGatewaySession>
}

interface LiveSession {
  readonly subjectId: string
  readonly agentMode: AgentMode
  readonly handle: AgentHandle
  readonly events: GatewayStreamEvent[]
  readonly waiters: Set<() => void>
  nextCursor: number
  activeRunId?: string
  cancelledRunId?: string
  disposed: boolean
}

const MAX_REPLAY_EVENTS = 512

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Gateway event stream aborted')
}

function waitForEvent(session: LiveSession, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError(signal))
  return new Promise<void>((resolve, reject) => {
    const wake = (): void => {
      signal?.removeEventListener('abort', abort)
      session.waiters.delete(wake)
      resolve()
    }
    const abort = (): void => {
      session.waiters.delete(wake)
      reject(abortError(signal as AbortSignal))
    }
    session.waiters.add(wake)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function wakeAll(session: LiveSession): void {
  for (const wake of [...session.waiters]) wake()
}

export class HarnessGatewaySessionService implements GatewaySessionService {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly requestIds = new Map<string, string>()
  private readonly admissions = new Map<string, Promise<void>>()
  private readonly stopSessionEvents: () => void
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly authorizer: GatewaySessionAuthorizer,
  ) {
    this.stopSessionEvents = ctx.on('session/event', (session, event) => {
      const live = this.sessions.get(session.id)
      if (live === undefined || live.activeRunId === undefined) return
      this.append(live, live.activeRunId, 'session.event', {
        sessionSeq: event.seq,
        eventType: event.type,
        event,
      })
    })
  }

  async submit(input: GatewaySessionSubmit): Promise<{ runId: string }> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return await this.withAdmission(input.sessionId, async () => await this.submitAuthorized(input, authorization))
  }

  private async submitAuthorized(
    input: GatewaySessionSubmit,
    authorization: AuthorizedGatewaySession,
  ): Promise<{ runId: string }> {
    let live = this.sessions.get(input.sessionId)
    if (live !== undefined && live.subjectId !== authorization.subjectId) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
    const requestKey = JSON.stringify([input.sessionId, input.clientRequestId])
    const existingRunId = this.requestIds.get(requestKey)
    if (existingRunId !== undefined) return { runId: existingRunId }
    if (live?.activeRunId !== undefined) throw new GatewaySessionError('SESSION_BUSY', 409)

    if (live === undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined) throw new GatewaySessionError('HARNESS_RUNTIME_UNAVAILABLE', 503)
      const handle = await agents.create({
        sessionId: SessionId(input.sessionId),
        meta: { cwd: process.cwd(), agentPreset: `shotgo-${authorization.agentMode}` },
        agentOptions: {
          provider: authorization.provider,
          model: authorization.model,
          maxTokens: authorization.maxTokens,
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      await handle.agent.whenIdle()
      live = {
        subjectId: authorization.subjectId,
        agentMode: authorization.agentMode,
        handle,
        events: [],
        waiters: new Set(),
        nextCursor: 1,
        disposed: false,
      }
      this.sessions.set(input.sessionId, live)
    }

    const runId = crypto.randomUUID()
    live.activeRunId = runId
    this.requestIds.set(requestKey, runId)
    this.append(live, runId, 'run.accepted', { clientRequestId: input.clientRequestId })
    live.handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: input.text }],
      source: { kind: 'user' },
    }))
    void this.settle(live, runId)
    return { runId }
  }

  async events(input: GatewaySessionAccess): Promise<AsyncIterable<GatewayStreamEvent>> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = this.sessions.get(input.sessionId)
    if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
    if (live.subjectId !== authorization.subjectId) throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    const earliest = live.events[0]?.cursor ?? live.nextCursor
    if (input.afterCursor < earliest - 1) throw new GatewaySessionError('SSE_CURSOR_EXPIRED', 409)

    return this.readEvents(live, input.afterCursor, input.signal)
  }

  private async * readEvents(
    live: LiveSession,
    afterCursor: number,
    signal?: AbortSignal,
  ): AsyncIterable<GatewayStreamEvent> {
    let cursor = afterCursor
    while (!live.disposed) {
      const available = live.events.filter(event => event.cursor > cursor)
      for (const event of available) {
        cursor = event.cursor
        yield event
        if (event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed') return
      }
      await waitForEvent(live, signal)
    }
  }

  async cancel(input: GatewaySessionCancel): Promise<void> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = this.sessions.get(input.sessionId)
    if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
    if (live.subjectId !== authorization.subjectId) throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    if (live.activeRunId !== input.runId) throw new GatewaySessionError('RUN_NOT_ACTIVE', 409)
    live.cancelledRunId = input.runId
    live.handle.agent.cancel({ kind: 'user' })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.stopSessionEvents()
    const live = [...this.sessions.values()]
    for (const session of live) {
      session.disposed = true
      wakeAll(session)
    }
    await Promise.all(live.map(session => session.handle.dispose()))
    this.sessions.clear()
  }

  private async settle(live: LiveSession, runId: string): Promise<void> {
    try {
      await live.handle.agent.whenIdle()
      const sessions = this.ctx.get('sessions')
      if (sessions !== undefined) await sessions.flush(live.handle.agent.session)
      const cancelled = live.cancelledRunId === runId
      this.append(live, runId, cancelled ? 'run.cancelled' : 'run.completed', {})
    } catch (error) {
      this.append(live, runId, 'run.failed', {
        code: 'HARNESS_RUN_FAILED',
        message: error instanceof Error ? error.message : 'Harness run failed',
      })
    } finally {
      if (live.activeRunId === runId) delete live.activeRunId
      if (live.cancelledRunId === runId) delete live.cancelledRunId
    }
  }

  private append(
    live: LiveSession,
    runId: string,
    type: GatewayStreamEvent['type'],
    payload: Record<string, unknown>,
  ): void {
    live.events.push(Object.freeze({
      protocolVersion: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      cursor: live.nextCursor++,
      sessionId: live.handle.agent.session.id,
      runId,
      agentMode: live.agentMode,
      occurredAt: new Date().toISOString(),
      type,
      payload,
    }))
    if (live.events.length > MAX_REPLAY_EVENTS) live.events.splice(0, live.events.length - MAX_REPLAY_EVENTS)
    wakeAll(live)
  }

  private assertOpen(): void {
    if (this.disposed) throw new GatewaySessionError('GATEWAY_SESSION_SERVICE_DISPOSED', 503)
  }

  private async withAdmission<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.admissions.get(sessionId) ?? Promise.resolve()
    const release = Promise.withResolvers<void>()
    const tail = previous.then(async () => {
      await release.promise
    })
    this.admissions.set(sessionId, tail)
    await previous
    try {
      return await task()
    } finally {
      release.resolve()
      if (this.admissions.get(sessionId) === tail) this.admissions.delete(sessionId)
    }
  }
}
