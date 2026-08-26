import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
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
import type { LaravelCanvasContextClient } from './laravel/canvas-context-client.ts'
import type { LaravelCanvasPlanClient } from './laravel/canvas-plan-client.ts'
import {
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  type GatewayGenerationContext,
  type GatewayStreamEvent,
} from './contracts/gateway-v1.ts'
import { GatewaySessionError } from './gateway-errors.ts'
import {
  GatewayRecoveryStore,
  SHOTGO_GATEWAY_RECOVERY_VERSION,
  SHOTGO_GATEWAY_RUNTIME_VERSION,
  type GatewayRecoveryBinding,
} from './gateway-recovery-store.ts'
import { resolveSessionRoot } from './runtime.ts'
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
  readonly streamEpoch: string
  nextCursor: number
  activeRunId?: string
  activeGenerationContext?: GatewayGenerationContext
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

function waitForEvent(session: LiveSession, afterCursor: number, signal?: AbortSignal): Promise<void> {
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
    // Close the gap between the caller's availability scan and waiter
    // registration. Without this recheck an event appended in that window has
    // no waiter to wake, leaving an otherwise live SSE stream blocked forever.
    if (session.events.some(event => event.cursor > afterCursor)) wake()
  })
}

function wakeAll(session: LiveSession): void {
  for (const wake of [...session.waiters]) wake()
}

function generationMessage(text: string, context: GatewayGenerationContext | undefined): string {
  if (context === undefined) return text
  return [
    'The following JSON records generation settings explicitly selected in the ShotGo UI.',
    'Use these values unchanged when calling generation_quote. Laravel remains authoritative and may reject stale values.',
    'Reference assets, when present in generationContext, are trusted UI selections and are injected into the quote by the Gateway. The generation_quote tool intentionally has no referenceAssets argument. Do not claim that references are unsupported merely because that argument is absent.',
    JSON.stringify({ userRequest: text, generationContext: context }),
  ].join('\n')
}

/**
 * Keep the browser replay window focused on events the ShotGo UI can consume.
 * Harness persists fine-grained reasoning and tool-argument chunks for audit,
 * but forwarding those chunks can evict an approval before the SSE client has
 * connected (one encrypted quote argument may contain thousands of chunks).
 */
export function shouldForwardSessionEvent(event: SessionEvent): boolean {
  if (event.type === 'assistant/chunk') return event.data.chunk.type === 'text-delta'
  return event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result'
}

export class HarnessGatewaySessionService implements GatewaySessionService {
  private readonly sessions = new Map<string, LiveSession>()
  private readonly requestIds = new Map<string, { runId: string; fingerprint: string }>()
  private readonly admissions = new Map<string, Promise<void>>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly resolvedApprovals = new Map<string, ResolvedApproval>()
  private readonly stopSessionEvents: () => void
  private readonly stopApprovalRequests?: () => void
  private readonly stopGenerationConfigReader?: () => void
  private readonly stopGenerationQuoteReader?: () => void
  private readonly stopGenerationSubmitter?: () => void
  private readonly stopGenerationLifecycle?: () => void
  private readonly stopCanvasContextReader?: () => void
  private readonly stopCanvasPlanQuoteReader?: () => void
  private readonly stopCanvasPlanSubmitter?: () => void
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
    private readonly recoveryStore = new GatewayRecoveryStore(`${resolveSessionRoot()}/.gateway`),
    canvasContext?: LaravelCanvasContextClient,
    canvasPlan?: LaravelCanvasPlanClient,
  ) {
    if (canvasContext !== undefined) {
      this.stopCanvasContextReader = ctx.provide('shotgoCanvasContextReader', {
        read: async ({ sessionId, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          if (live.agentMode !== 'canvas') throw new GatewaySessionError('CANVAS_CONTEXT_DENIED', 403)
          return await canvasContext.read({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
    if (canvasPlan !== undefined) {
      this.stopCanvasPlanQuoteReader = ctx.provide('shotgoCanvasPlanQuoteReader', {
        quote: async ({ sessionId, revision, summary, nodes, dependencies, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          if (live.agentMode !== 'canvas') throw new GatewaySessionError('CANVAS_PLAN_DENIED', 403)
          return await canvasPlan.quote({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            revision,
            summary,
            nodes,
            dependencies,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
      this.stopCanvasPlanSubmitter = ctx.provide('shotgoCanvasPlanSubmitter', {
        apply: async ({ sessionId, actionId, quoteId, quoteVersion, signal }) => {
          const live = this.sessions.get(sessionId)
          if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
          if (live.agentMode !== 'canvas') throw new GatewaySessionError('CANVAS_PLAN_DENIED', 403)
          if (live.activeRunId === undefined) throw new GatewaySessionError('RUN_NOT_ACTIVE', 409)
          const digest = createHash('sha256').update(`${sessionId}\0${quoteId}`).digest('hex')
          const clientRequestId = `canvas-${digest.slice(0, 57)}`
          return await canvasPlan.apply({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            runId: live.activeRunId,
            actionId,
            clientRequestId,
            quoteId,
            quoteVersion,
            ...(signal === undefined ? {} : { signal }),
          })
        },
      })
    }
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
          const selected = live.activeGenerationContext
          let quoteParameters = parameters
          if (selected !== undefined) {
            const prompt = parameters.prompt
            if (typeof prompt !== 'string' || prompt.trim() === '') {
              throw new GatewaySessionError('GENERATION_PROMPT_REQUIRED', 422)
            }
            const selectedParameters = Object.fromEntries(Object.entries(selected.parameters))
            quoteParameters = { prompt, ...selectedParameters }
          }
          return await generationQuote.quote({
            capabilityGrant: live.capabilityGrant.current,
            sessionId,
            kind: selected?.kind ?? kind,
            modelId: selected?.modelId ?? modelId,
            parameters: quoteParameters,
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
        this.appendApprovalEventOnce(live, live.activeRunId, 'approval.requested', {
          approvalId: event.data.id,
          toolName: event.data.toolName,
          ...event.data.callId === undefined ? {} : { callId: event.data.callId },
          ...event.data.reason === undefined ? {} : { reason: event.data.reason },
        })
      } else if (event.type === 'approval/decided') {
        this.appendApprovalEventOnce(live, live.activeRunId, 'approval.resolved', {
          approvalId: event.data.id,
          outcome: event.data.outcome,
        })
      } else if (shouldForwardSessionEvent(event)) {
        this.append(live, live.activeRunId, 'session.event', {
          sessionSeq: event.seq,
          eventType: event.type,
          event,
        })
      }
    })
    if (ctx.get('approval') !== undefined) {
      this.stopApprovalRequests = ctx.on('approval/request', (request, next) => {
        if (!['generation_submit', 'generation_cancel', 'canvas_ops_apply'].includes(request.toolName)) return next()
        if (request.signal?.aborted === true) return Promise.resolve<ApprovalOutcome>('cancelled')
        const live = this.sessions.get(request.agent.session.id)
        if (live === undefined || live.handle.agent !== request.agent || live.activeRunId === undefined) return next()
        const approvalId = this.findPendingApprovalId(request.agent.session.events, request.callId)
        if (approvalId === undefined) return next()
        const runId = live.activeRunId
        // approval/asked and approval/decided are log-only audit records. Some
        // runtime compositions persist them without publishing them on the
        // parent session/event firehose, so the owning approval answerer is the
        // authoritative live UI seam. Keep the session/event listener above as
        // a compatible fallback and deduplicate both paths by approval id.
        this.appendApprovalEventOnce(live, runId, 'approval.requested', {
          approvalId,
          toolName: request.toolName,
          ...request.callId === undefined ? {} : { callId: request.callId },
          ...request.reason === undefined ? {} : { reason: request.reason },
        })
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
            setImmediate(() => {
              if (this.disposed || live.disposed) return
              const decided = request.agent.session.events.findLast(
                (event): event is Extract<SessionEvent, { type: 'approval/decided' }> =>
                  event.type === 'approval/decided' && event.data.id === approvalId,
              )
              if (decided === undefined) return
              this.appendApprovalEventOnce(live, runId, 'approval.resolved', {
                approvalId,
                outcome: decided.data.outcome,
              })
            })
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

  async submit(input: GatewaySessionSubmit): Promise<{ runId: string; streamEpoch: string }> {
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
  ): Promise<{ runId: string; streamEpoch: string }> {
    let live = this.sessions.get(input.sessionId)
    if (live === undefined) {
      live = await this.resumeAuthorized(input.capabilityGrant, authorization, input.signal)
    }
    if (live !== undefined && !hasSameAuthorizationContext(live, authorization)) {
      throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    }
    const requestKey = JSON.stringify([input.sessionId, input.clientRequestId])
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ text: input.text, generationContext: input.generationContext ?? null }))
      .digest('hex')
    const existingRequest = this.requestIds.get(requestKey)
    if (existingRequest !== undefined) {
      if (existingRequest.fingerprint !== requestFingerprint) {
        throw new GatewaySessionError('IDEMPOTENCY_CONFLICT', 409)
      }
      if (live === undefined) throw new GatewaySessionError('SESSION_NOT_FOUND', 404)
      return { runId: existingRequest.runId, streamEpoch: live.streamEpoch }
    }
    if (live?.activeRunId !== undefined) throw new GatewaySessionError('SESSION_BUSY', 409)
    if (input.generationContext !== undefined && input.generationContext.kind !== authorization.agentMode) {
      throw new GatewaySessionError('GENERATION_CONTEXT_MODE_MISMATCH', 422)
    }

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
      const binding: GatewayRecoveryBinding = {
        version: SHOTGO_GATEWAY_RECOVERY_VERSION,
        runtimeVersion: SHOTGO_GATEWAY_RUNTIME_VERSION,
        sessionId: authorization.sessionId,
        authorizationContextId: authorization.authorizationContextId,
        userId: authorization.userId,
        teamId: authorization.teamId,
        spaceId: authorization.spaceId,
        projectId: authorization.projectId,
        agentMode: authorization.agentMode,
        presetId,
        createdAt: new Date().toISOString(),
      }
      try {
        await this.recoveryStore.write(binding)
      } catch (error) {
        await handle.dispose()
        throw new GatewaySessionError('SESSION_RECOVERY_BINDING_WRITE_FAILED', 503, error instanceof Error ? error.message : undefined)
      }
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
        streamEpoch: randomUUID(),
        nextCursor: 1,
        disposed: false,
      }
      this.sessions.set(input.sessionId, live)
    }

    const runId = crypto.randomUUID()
    live.activeRunId = runId
    if (input.generationContext === undefined) {
      delete live.activeGenerationContext
    } else {
      live.activeGenerationContext = input.generationContext
    }
    this.requestIds.set(requestKey, { runId, fingerprint: requestFingerprint })
    this.append(live, runId, 'run.accepted', { clientRequestId: input.clientRequestId })
    live.handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: generationMessage(input.text, input.generationContext) }],
      source: { kind: 'user' },
    }))
    void this.settle(live, runId)
    return { runId, streamEpoch: live.streamEpoch }
  }

  private async resumeAuthorized(
    capabilityGrant: string,
    authorization: AuthorizedGatewaySession,
    signal?: AbortSignal,
  ): Promise<LiveSession | undefined> {
    let binding: GatewayRecoveryBinding | undefined
    try {
      binding = await this.recoveryStore.read(authorization.sessionId)
    } catch {
      throw new GatewaySessionError('SESSION_RECOVERY_BINDING_INVALID', 409)
    }
    if (binding === undefined) return undefined
    if (
      binding.runtimeVersion !== SHOTGO_GATEWAY_RUNTIME_VERSION
      || binding.presetId !== `shotgo-${authorization.agentMode}-v1`
      || binding.authorizationContextId !== authorization.authorizationContextId
      || binding.userId !== authorization.userId
      || binding.teamId !== authorization.teamId
      || binding.spaceId !== authorization.spaceId
      || binding.projectId !== authorization.projectId
      || binding.agentMode !== authorization.agentMode
    ) throw new GatewaySessionError('SESSION_ACCESS_DENIED', 403)
    const agents = this.ctx.get('agents')
    if (agents === undefined) throw new GatewaySessionError('HARNESS_RUNTIME_UNAVAILABLE', 503)
    let handle: AgentHandle
    try {
      handle = await agents.resume({
        resumeSessionId: SessionId(authorization.sessionId),
        agentOptions: {
          provider: authorization.provider,
          model: authorization.model,
          maxTokens: authorization.maxTokens,
        },
        setup: async agentCtx => await this.mountAgentPreset(agentCtx, authorization.agentMode),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw new GatewaySessionError('SESSION_RECOVERY_FAILED', 409, error instanceof Error ? error.message : undefined)
    }
    await handle.agent.whenIdle()
    const live: LiveSession = {
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
      capabilityGrant: { current: capabilityGrant },
      streamEpoch: randomUUID(),
      nextCursor: 1,
      disposed: false,
    }
    this.sessions.set(authorization.sessionId, live)
    return live
  }

  async events(input: GatewaySessionAccess): Promise<AsyncIterable<GatewayStreamEvent>> {
    this.assertOpen()
    const authorization = await this.authorizer.authorize({
      capabilityGrant: input.capabilityGrant,
      sessionId: input.sessionId,
      requiredCapability: 'agent.session.events.read',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const live = await this.withAdmission(input.sessionId, async () =>
      this.sessions.get(input.sessionId)
      ?? await this.resumeAuthorized(input.capabilityGrant, authorization, input.signal),
    )
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
      await waitForEvent(live, cursor, signal)
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
    const live = await this.withAdmission(input.sessionId, async () =>
      this.sessions.get(input.sessionId)
      ?? await this.resumeAuthorized(input.capabilityGrant, authorization, input.signal),
    )
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
    const live = await this.withAdmission(input.sessionId, async () =>
      this.sessions.get(input.sessionId)
      ?? await this.resumeAuthorized(input.capabilityGrant, authorization, input.signal),
    )
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
    // The browser deliberately refreshes its short-lived Grant immediately
    // before answering. Carry that newly authorized credential into the
    // suspended tool call so generation_submit/cancel does not resume with the
    // older Grant captured when the run started.
    live.capabilityGrant.current = input.capabilityGrant
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
    this.stopCanvasContextReader?.()
    this.stopCanvasPlanQuoteReader?.()
    this.stopCanvasPlanSubmitter?.()
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
      if (live.activeRunId === runId) {
        delete live.activeRunId
        delete live.activeGenerationContext
      }
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
      streamEpoch: live.streamEpoch,
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

  private appendApprovalEventOnce(
    live: LiveSession,
    runId: string,
    type: 'approval.requested' | 'approval.resolved',
    payload: Record<string, unknown> & { approvalId: ApprovalRequestId },
  ): void {
    const duplicate = live.events.some(event =>
      event.type === type && event.payload['approvalId'] === payload.approvalId,
    )
    if (!duplicate) this.append(live, runId, type, payload)
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
