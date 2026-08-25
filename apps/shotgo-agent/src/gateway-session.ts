import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { AgentMode, AgentSessionCapability } from './contracts/laravel-v1.ts'
import type { LaravelGenerationConfigClient } from './laravel/generation-config-client.ts'
import type { LaravelGenerationQuoteClient } from './laravel/generation-quote-client.ts'
import type { LaravelGenerationSubmitClient } from './laravel/generation-submit-client.ts'
import type { LaravelGenerationLifecycleClient } from './laravel/generation-lifecycle-client.ts'
import {
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  type GatewayStreamEvent,
} from './contracts/gateway-v1.ts'
import { GatewaySessionError } from './gateway-errors.ts'
import type {
  GatewaySessionAccess,
  GatewaySessionApprovalResponse,
  GatewaySessionCancel,
  GatewaySessionService,
  GatewaySessionSubmit,
} from './gateway-transport.ts'

export interface AuthorizedGatewaySession {
  authorizationContextId: string
  expiresAt: string
  sessionId: string
  userId: number
  teamId: number | null
  spaceId: string | null
  projectId: string | null
  agentMode: AgentMode
  provider: string
  model: string
  maxTokens: number
}

export interface GatewaySessionAuthorizer {
  authorize(input: {
    capabilityGrant: string
    sessionId: string
    requiredCapability: AgentSessionCapability
    signal?: AbortSignal
  }): Promise<AuthorizedGatewaySession>
}

export type GatewayAgentPresetMounter = (agentCtx: Context, agentMode: AgentMode) => Promise<void>

interface LiveSession {
  readonly authorizationContextId: string
  readonly userId: number
  readonly teamId: number | null
  readonly spaceId: string | null
  readonly projectId: string | null
  readonly sessionId: string
  readonly agentMode: AgentMode
  readonly handle: AgentHandle
  readonly events: GatewayStreamEvent[]
  readonly waiters: Set<() => void>
  readonly capabilityGrant: { current: string }
  nextCursor: number
  activeRunId?: string
  cancelledRunId?: string
  disposed: boolean
}

interface PendingApproval {
  readonly approvalId: ApprovalRequestId
  readonly sessionId: string
  readonly settle: (outcome: ApprovalOutcome) => void
}

interface ResolvedApproval {
  readonly sessionId: string
  readonly outcome: ApprovalOutcome
}

const MAX_REPLAY_EVENTS = 512

function hasSameAuthorizationContext(live: LiveSession, authorization: AuthorizedGatewaySession): boolean {
  return live.authorizationContextId === authorization.authorizationContextId
    && live.userId === authorization.userId
    && live.teamId === authorization.teamId
    && live.spaceId === authorization.spaceId
    && live.projectId === authorization.projectId
    && live.sessionId === authorization.sessionId
    && live.agentMode === authorization.agentMode
}

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
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly resolvedApprovals = new Map<string, ResolvedApproval>()
  private readonly stopSessionEvents: () => void
  private readonly stopApprovalRequests?: () => void
  private readonly stopGenerationConfigReader?: () => void
  private readonly stopGenerationQuoteReader?: () => void
  private readonly stopGenerationSubmitter?: () => void
  private readonly stopGenerationLifecycle?: () => void
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly authorizer: GatewaySessionAuthorizer,
    private readonly mountAgentPreset: GatewayAgentPresetMounter = async (agentCtx, agentMode) => {
      const presets = ctx.get('agentPresets')
      if (presets === undefined) throw new GatewaySessionError('AGENT_PRESETS_UNAVAILABLE', 503)
      await presets.mount(agentCtx, `shotgo-${agentMode}-v1`)
    },
    generationConfig?: LaravelGenerationConfigClient,
    generationQuote?: LaravelGenerationQuoteClient,
    generationSubmit?: LaravelGenerationSubmitClient,
    generationLifecycle?: LaravelGenerationLifecycleClient,
  ) {
    if (generationConfig !== undefined) {
      this.stopGenerationConfigReader = ctx.provide('shotgoGenerationConfigReader', {
        read: async ({ kind, sessionId, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          return await generationConfig.read({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            kind,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
    if (generationQuote !== undefined) {
      this.stopGenerationQuoteReader = ctx.provide('shotgoGenerationQuoteReader', {
        quote: async ({ sessionId, kind, modelId, parameters, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          return await generationQuote.quote({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            kind,
            modelId,
            parameters,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
    if (generationSubmit !== undefined) {
      this.stopGenerationSubmitter = ctx.provide('shotgoGenerationSubmitter', {
        submit: async ({ sessionId, actionId, quoteId, quoteVersion, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          if (live.activeRunId === undefined) throw new GatewaySessionError('RUN_NOT_ACTIVE', 409)
          const clientRequestId = `gen-${createHash('sha256')
            .update(`${sessionId}\0${quoteId}`)
            .digest('hex')
            .slice(0, 60)}`
          return await generationSubmit.submit({
            capabilityGrant: live.capabilityGrant.current,
            context: {
              sessionId,
              runId: live.activeRunId,
              actionId,
              clientRequestId,
            },
            quoteId,
            quoteVersion,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
    if (generationLifecycle !== undefined) {
      this.stopGenerationLifecycle = ctx.provide('shotgoGenerationLifecycle', {
        read: async ({ sessionId, generationId, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          return await generationLifecycle.read({
            capabilityGrant: live.capabilityGrant.current,
            generationId,
            ...(signal === undefined ? {} : { signal }),
          })
        },
        recover: async ({ sessionId, clientRequestId, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          return await generationLifecycle.recover({
            capabilityGrant: live.capabilityGrant.current,
            clientRequestId,
            ...(signal === undefined ? {} : { signal }),
          })
        },
        cancel: async ({ sessionId, actionId, generationId, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          if (live.activeRunId === undefined) throw new GatewaySessionError('RUN_NOT_ACTIVE', 409)
          const clientRequestId = `cancel-${createHash('sha256')
            .update(`${sessionId}\0${generationId}`)
            .digest('hex')
            .slice(0, 57)}`
          return await generationLifecycle.cancel({
            capabilityGrant: live.capabilityGrant.current,
            generationId,
            context: { sessionId, runId: live.activeRunId, actionId, clientRequestId },
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
    this.stopSessionEvents = ctx.on('session/event', (session, event) => {
      const live = this.sessions.get(session.id)
      if (live === undefined || live.activeRunId === undefined) return
      if (event.type === 'approval/asked') {
        this.append(live, live.activeRunId, 'approval.requested', {
          approvalId: event.data.id,
          toolName: event.data.toolName,
          ...event.data.callId === undefined ? {} : { callId: event.data.callId },
          ...event.data.reason === undefined ? {} : { reason: event.data.reason },
        })
      } else if (event.type === 'approval/decided') {
        this.append(live, live.activeRunId, 'approval.resolved', {
          approvalId: event.data.id,
          outcome: event.data.outcome,
        })
      } else {
        this.append(live, live.activeRunId, 'session.event', {
          sessionSeq: event.seq,
          eventType: event.type,
          event,
        })
      }
    })
    if (ctx.get('approval') !== undefined) {
      this.stopApprovalRequests = ctx.on('approval/request', (request, next) => {
        if (!['generation_submit', 'generation_cancel'].includes(request.toolName)) return next()
        if (request.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
        const live = this.sessions.get(request.agent.session.id)
        if (live === undefined || live.handle.agent !== request.agent || live.activeRunId === undefined) return next()
        const approvalId = this.findPendingApprovalId(request.agent.session.events, request.callId)
        if (approvalId === undefined) return next()
        return new Promise<ApprovalOutcome>((resolve) => {
          let settled = false
          const onAbort = (): void => {
            settle('cancelled')
          }
          const settle = (outcome: ApprovalOutcome): void => {
            if (settled) return
            settled = true
            request.signal?.removeEventListener('abort', onAbort)
            this.pendingApprovals.delete(approvalId)
            resolve(outcome)
          }
          this.pendingApprovals.set(approvalId, {
            approvalId,
            sessionId: live.sessionId,
            settle,
          })
          request.signal?.addEventListener('abort', onAbort, { once: true })
        })
      })
    }
  }

  async submit(input: GatewaySessionSubmit): Promise<{ runId: string }> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      requiredCapability: 'agent.session.submit',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return await this.withAdmission(input.sessionId, async () => await this.submitAuthorized(input, authorization))
  }

  private async submitAuthorized(
    input: GatewaySessionSubmit,
    authorization: AuthorizedGatewaySession,
  ): Promise<{ runId: string }> {
    let live = this.sessions.get(input.sessionId)
    if (live !== undefined && !hasSameAuthorizationContext(live, authorization)) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
    const requestKey = JSON.stringify([input.sessionId, input.clientRequestId])
    const existingRunId = this.requestIds.get(requestKey)
    if (existingRunId !== undefined) return { runId: existingRunId }
    if (live?.activeRunId !== undefined) throw new GatewaySessionError('SESSION_BUSY', 409)

    if (live !== undefined) live.capabilityGrant.current = input.capabilityGrant

    if (live === undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined) throw new GatewaySessionError('HARNESS_RUNTIME_UNAVAILABLE', 503)
      const presetId = `shotgo-${authorization.agentMode}-v1`
      const capabilityGrant = { current: input.capabilityGrant }
      const handle = await agents.create({
        sessionId: SessionId(input.sessionId),
        meta: { cwd: process.cwd(), agentPreset: presetId },
        agentOptions: {
          provider: authorization.provider,
          model: authorization.model,
          maxTokens: authorization.maxTokens,
        },
        setup: async (agentCtx) => {
          await this.mountAgentPreset(agentCtx, authorization.agentMode)
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      await handle.agent.whenIdle()
      live = {
        authorizationContextId: authorization.authorizationContextId,
        userId: authorization.userId,
        teamId: authorization.teamId,
        spaceId: authorization.spaceId,
        projectId: authorization.projectId,
        sessionId: authorization.sessionId,
        agentMode: authorization.agentMode,
        handle,
        events: [],
        waiters: new Set(),
        capabilityGrant,
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
      requiredCapability: 'agent.session.events.read',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = this.sessions.get(input.sessionId)
    if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
    if (!hasSameAuthorizationContext(live, authorization)) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
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
      requiredCapability: 'agent.session.cancel',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = this.sessions.get(input.sessionId)
    if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
    if (!hasSameAuthorizationContext(live, authorization)) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
    if (live.activeRunId !== input.runId) throw new GatewaySessionError('RUN_NOT_ACTIVE', 409)
    live.cancelledRunId = input.runId
    live.handle.agent.cancel({ kind: 'user' })
  }

  async respondToApproval(input: GatewaySessionApprovalResponse): Promise<void> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      requiredCapability: 'agent.session.approval.respond',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = this.sessions.get(input.sessionId)
    if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
    if (!hasSameAuthorizationContext(live, authorization)) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
    const pending = this.pendingApprovals.get(input.approvalId)
    const resolved = this.resolvedApprovals.get(input.approvalId)
    if (resolved !== undefined) {
      if (resolved.sessionId === input.sessionId && resolved.outcome === input.outcome) return
      throw new GatewaySessionError('APPROVAL_ALREADY_RESOLVED', 409)
    }
    if (pending === undefined || pending.sessionId !== input.sessionId) {
      throw new GatewaySessionError('APPROVAL_NOT_PENDING', 409)
    }
    this.resolvedApprovals.set(input.approvalId, {
      sessionId: input.sessionId,
      outcome: input.outcome,
    })
    if (this.resolvedApprovals.size > MAX_REPLAY_EVENTS) {
      const oldest = this.resolvedApprovals.keys().next().value
      if (oldest !== undefined) this.resolvedApprovals.delete(oldest)
    }
    pending.settle(input.outcome)
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
    for (const pending of [...this.pendingApprovals.values()]) pending.settle('cancelled')
    this.stopApprovalRequests?.()
    this.stopGenerationConfigReader?.()
    this.stopGenerationQuoteReader?.()
    this.stopGenerationSubmitter?.()
    this.stopGenerationLifecycle?.()
    this.sessions.clear()
    this.resolvedApprovals.clear()
  }

  private findPendingApprovalId(
    events: readonly SessionEvent[],
    callId: string | undefined,
  ): ApprovalRequestId | undefined {
    const decided = new Set<ApprovalRequestId>()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as SessionEvent
      if (event.type === 'approval/decided') {
        decided.add(event.data.id)
        continue
      }
      if (event.type !== 'approval/asked') continue
      if (decided.has(event.data.id) || this.pendingApprovals.has(event.data.id)) continue
      if ((event.data.callId ?? null) !== (callId ?? null)) continue
      return event.data.id
    }
    return undefined
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
