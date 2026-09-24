import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth.tsx'
import type {
  AgentMessage,
  AgentSessionRecord,
  ExecutionMode,
  GenerationContext,
  SessionPhase,
} from './agent-session.ts'
import {
  assistantDelta,
  creativeRevisionLifecycle,
  creativeWorkflow,
  exceptionDecision,
  generationArtifacts,
  generationRefsFromEvent,
  mergeGenerationArtifacts,
  mergeGenerationRefs,
  terminal,
} from './agent-session.ts'
import { cancelRun, createGrant, respondRunStart, streamRun, submitMessage } from './gateway-client.ts'
import { appendUserPrompt } from './server-session-index.ts'
import { ExceptionDecisionClient } from './exception-decision-client.ts'
import { ExceptionDecisionRecovery } from './exception-decision-recovery.ts'
import type { ExceptionDecisionState } from './exception-decision.ts'
import { isPermanentGatewayStreamError } from './gateway-exception-stream.ts'
import { connectionInterruptedMessage, isBrowserOffline, sendBlockedOfflineMessage } from './network-error.ts'

function newMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte
    return pinned.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function stoppedMessage(code: unknown): string {
  if (code === 'AUTO_POLICY_HARD_BUDGET_EXCEEDED') return '预算不足，任务已停止；未自动重提。'
  if (['CAPABILITY_NOT_ALLOWED', 'CAPABILITY_GRANT_REJECTED', 'CREATIVE_PROJECT_CAPABILITY_NOT_GRANTED'].includes(String(code)))
    return '执行权限不足，任务已停止；未自动重提。'
  if (code === 'GENERATION_OUTCOME_UNKNOWN' || code === 'CREATIVE_PROJECT_OUTCOME_UNKNOWN')
    return '提交结果未知，需要核对原任务；禁止重新提交。'
  if (code === 'CREATIVE_RUN_ADMISSION_UNAVAILABLE')
    return '当前工作台走普通图/视频生成；请刷新页面后重新发送。'
  return '任务执行失败，原任务保留；请恢复连接或核对结果。'
}

export function useAgentSession(input: {
  session: AgentSessionRecord
  executionMode: ExecutionMode
  spaceId?: string
  projectId?: string
  /** Must synchronously persist before returning; a thrown storage error blocks approval POST. */
  onSessionChange(session: AgentSessionRecord): void
}) {
  const { token } = useAuth()
  const [phase, setPhase] = useState<SessionPhase>('idle')
  const [error, setError] = useState<string>()
  /** Paid Run stream lost; keep hang UI until events resume or the Run settles. */
  const [connectionLost, setConnectionLost] = useState(false)
  const [decisions, setDecisions] = useState<ExceptionDecisionState>({})
  const [pendingRunStart, setPendingRunStart] = useState<{ approvalId: string; runId: string; reason?: string }>()
  const [runStartResponding, setRunStartResponding] = useState(false)
  const responseInFlight = useRef(false)
  const cancelInFlight = useRef(false)
  const [reconnectGeneration, setReconnectGeneration] = useState(0)
  const abortRef = useRef<AbortController>()
  const runRef = useRef<{ runId: string; grant: string }>()
  const grantRef = useRef<{ grantToken: string; expiresAt: string; sessionId: string; agentMode: 'image' | 'video' }>()
  const sessionRef = useRef(input.session)
  const phaseRef = useRef<SessionPhase>('idle')
  phaseRef.current = phase

  useEffect(() => {
    sessionRef.current = input.session
  }, [input.session])
  useEffect(() => () => abortRef.current?.abort(), [])

  const decisionClient = useRef(
    new ExceptionDecisionClient({
      apiBaseUrl: import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn',
      accessToken: () => localStorage.getItem('shotgo-agent-access-token') ?? undefined,
    }),
  ).current
  const recovery = useRef<ExceptionDecisionRecovery>()
  useEffect(() => {
    abortRef.current?.abort()
    runRef.current = undefined
    grantRef.current = undefined
    setPhase('idle')
    setError(undefined)
    setDecisions({})
    setPendingRunStart(undefined)
    setRunStartResponding(false)
    responseInFlight.current = false
    cancelInFlight.current = false
    recovery.current = new ExceptionDecisionRecovery(
      input.session.sessionId,
      decisionClient,
      localStorage,
      setDecisions,
    )
    void recovery.current.recover()
  }, [decisionClient, input.session.sessionId])

  const update = useCallback(
    (mutate: (session: AgentSessionRecord) => AgentSessionRecord) => {
      const next = mutate(sessionRef.current)
      sessionRef.current = next
      input.onSessionChange(next)
    },
    [input],
  )

  const resolveRunStart = useCallback(
    async (
      pending: { approvalId: string; runId: string },
      outcome: 'allowed-once' | 'rejected',
    ) => {
      const run = runRef.current
      const signal = abortRef.current?.signal
      if (
        run === undefined ||
        signal === undefined ||
        run.runId !== pending.runId ||
        runStartResponding ||
        responseInFlight.current ||
        sessionRef.current.activeRun?.respondedApprovalIds?.includes(pending.approvalId)
      ) {
        return
      }
      setRunStartResponding(true)
      responseInFlight.current = true
      try {
        // Persist intent before sending: a lost response must never unlock a second approval POST.
        update(session => ({
          ...session,
          activeRun:
            session.activeRun?.runId === pending.runId
              ? {
                ...session.activeRun,
                respondedApprovalIds: [
                  ...new Set([...(session.activeRun.respondedApprovalIds ?? []), pending.approvalId]),
                ],
              }
              : session.activeRun,
        }))
        setPendingRunStart(undefined)
        await respondRunStart({
          grant: run.grant,
          sessionId: input.session.sessionId,
          approvalId: pending.approvalId,
          outcome,
          signal,
        })
      } catch {
        setPendingRunStart(undefined)
        if (!signal.aborted) {
          setError('开始确认结果未知；禁止重复确认，请恢复原任务连接。')
          setPhase('error')
        }
      } finally {
        setRunStartResponding(false)
        responseInFlight.current = false
      }
    },
    [input.session.sessionId, runStartResponding, update],
  )

  const handleApprovalRequested = useCallback(
    (event: { runId: string; payload: Record<string, unknown> }, mode: ExecutionMode) => {
      const approvalId = event.payload.approvalId
      if (typeof approvalId !== 'string') return
      if (sessionRef.current.activeRun?.respondedApprovalIds?.includes(approvalId)) return
      const pending = {
        approvalId,
        runId: event.runId,
        ...(typeof event.payload.reason === 'string' ? { reason: event.payload.reason } : {}),
      }
      if (mode === 'manual') {
        setPendingRunStart(pending)
        return
      }
      // Automatic mode never shows the Run Start card; answer immediately.
      void resolveRunStart(pending, 'allowed-once')
    },
    [resolveRunStart],
  )
  const handleApprovalRequestedRef = useRef(handleApprovalRequested)
  handleApprovalRequestedRef.current = handleApprovalRequested

  // Browser offline: cable unplug / Wi-Fi drop often stalls fetch/SSE without rejecting.
  // Mark the paid Run hung immediately so the banner is visible; auto-resume waits for online.
  useEffect(() => {
    const markOffline = () => {
      if (!isBrowserOffline()) return
      const hasActiveRun = sessionRef.current.activeRun !== undefined
      const inFlight = phaseRef.current === 'authorizing' || phaseRef.current === 'running'
      if (!hasActiveRun && !inFlight) return
      abortRef.current?.abort()
      if (hasActiveRun) {
        setConnectionLost(true)
        setError(connectionInterruptedMessage('网络已断开'))
        setPhase('error')
      }
    }
    window.addEventListener('offline', markOffline)
    const timer = window.setInterval(markOffline, 1_500)
    return () => {
      window.removeEventListener('offline', markOffline)
      window.clearInterval(timer)
    }
  }, [])

  // Browser offline OR Gateway briefly down: keep retrying the original Run stream (no resubmit).
  // `online` alone is not enough — killing local :3012 does not flip navigator.onLine.
  // Never clear the hang banner here; users must keep seeing why the Run is paused.
  useEffect(() => {
    if (!connectionLost) return
    if (sessionRef.current.activeRun === undefined) return
    const resume = () => {
      if (sessionRef.current.activeRun === undefined) return
      if (isBrowserOffline()) return
      // Skip only while a recovery connect is already opening; otherwise bump stream.
      if (phaseRef.current === 'authorizing') return
      cancelInFlight.current = false
      if (phaseRef.current === 'running') abortRef.current?.abort()
      setError(current =>
        connectionInterruptedMessage(
          current && current.includes('正在重连') ? current : '连接已中断，正在重连原任务（不会重新提交）…',
        ),
      )
      setPhase('error')
      setReconnectGeneration(value => value + 1)
    }
    window.addEventListener('online', resume)
    const timer = window.setInterval(resume, 4_000)
    // First probe shortly after hang so recovery is not stuck waiting a full interval.
    const immediate = window.setTimeout(resume, 800)
    return () => {
      window.removeEventListener('online', resume)
      window.clearInterval(timer)
      window.clearTimeout(immediate)
    }
  }, [connectionLost])

  useEffect(() => {
    const saved = sessionRef.current
    const active = saved.activeRun
    if (!active || !saved.streamEpoch || token === null || typeof active.runId !== 'string'
      || typeof active.assistantId !== 'string' || !['automatic', 'manual'].includes(active.executionMode)) return
    if (active.projectId !== input.projectId || active.spaceId !== input.spaceId) {
      setConnectionLost(true)
      setError('恢复范围不一致；原任务保留，禁止重新提交。')
      setPhase('error')
      return
    }
    const controller = new AbortController()
    let lastApplied = saved.cursor
    let settled = false
    let epoch = saved.streamEpoch
    abortRef.current = controller
    setPhase('authorizing')
    const getGrant = async () => {
      const grant = await createGrant({ token, sessionId: saved.sessionId, mode: saved.mode,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }), signal: controller.signal })
      if (grant.sessionId !== saved.sessionId || grant.agentMode !== saved.mode) throw new Error('RECOVERY_SCOPE_MISMATCH')
      if (!controller.signal.aborted) runRef.current = { runId: active.runId, grant: grant.grantToken }
      return grant
    }
    void streamRun({ getGrant, sessionId: saved.sessionId, runId: active.runId, streamEpoch: saved.streamEpoch,
      afterCursor: saved.cursor, signal: controller.signal,
      onEpoch: (value) => {
        if (controller.signal.aborted) return
        epoch = value
        update(session => ({ ...session, streamEpoch: value }))
      },
      onCursor: (cursor) => {
        if (!controller.signal.aborted) update(session => ({ ...session, cursor: Math.max(session.cursor, cursor) }))
      },
      onEvent: (event) => {
        if (controller.signal.aborted || settled || event.sessionId !== saved.sessionId || event.runId !== active.runId
          || event.streamEpoch !== epoch || event.cursor <= lastApplied) return
        lastApplied = event.cursor
        setConnectionLost(false)
        setError(undefined)
        setPhase('running')
        const workflow = creativeWorkflow(event)
        if (workflow) update(session => session.workflow && session.workflow.projectRevision > workflow.projectRevision
          ? session : { ...session, workflow })
        const revision = creativeRevisionLifecycle(event)
        if (revision) update(session => ({ ...session, revision }))
        const decision = exceptionDecision(event)
        if (decision) recovery.current?.upsert(decision)
        if (event.type === 'approval.requested')
          handleApprovalRequestedRef.current(event, active.executionMode)
        if (event.type === 'approval.resolved') {
          const approvalId = event.payload.approvalId
          if (typeof approvalId === 'string' && sessionRef.current.activeRun?.respondedApprovalIds?.includes(approvalId)) setError(undefined)
          if (typeof approvalId === 'string') update(session => ({ ...session, activeRun: session.activeRun ? { ...session.activeRun,
            respondedApprovalIds: [...new Set([...(session.activeRun.respondedApprovalIds ?? []), approvalId])] } : undefined }))
          setPendingRunStart(undefined)
        }
        const delta = assistantDelta(event)
        const artifacts = generationArtifacts(event)
        const generationRefs = generationRefsFromEvent(event)
        if (delta !== undefined || artifacts !== undefined || generationRefs !== undefined) {
          update(session => ({
            ...session,
            messages: session.messages.map((message) => {
              if (message.id !== active.assistantId) return message
              const mergedRefs = generationRefs === undefined
                ? undefined
                : mergeGenerationRefs(message.generationRefs, generationRefs)
              const mergedArtifacts = artifacts === undefined
                ? undefined
                : mergeGenerationArtifacts(message.artifacts, artifacts)
              return {
                ...message,
                ...(delta === undefined ? {} : { text: message.text + delta }),
                ...(mergedArtifacts === undefined ? {} : { artifacts: mergedArtifacts }),
                ...(mergedRefs === undefined ? {} : { generationRefs: mergedRefs }),
              }
            }),
          }))
        }
        if (terminal(event, active.runId)) {
          settled = true
          setConnectionLost(false)
          setPendingRunStart(undefined)
          if (event.type === 'run.failed') setError(stoppedMessage(event.payload.code))
          update(session => ({ ...session, activeRun: event.type === 'run.failed' ? session.activeRun : undefined,
            workflow: event.type === 'run.completed' ? session.workflow : undefined, messages: session.messages.map(message =>
              message.id !== active.assistantId ? message : { ...message,
                status: event.type === 'run.completed' ? 'complete' : event.type === 'run.cancelled' ? 'cancelled' : 'failed' }) }))
          setPhase(event.type === 'run.failed' ? 'error' : 'idle')
          runRef.current = undefined
        }
      },
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      const detail = cause instanceof Error ? cause.message : undefined
      if (isPermanentGatewayStreamError(cause)) {
        setConnectionLost(false)
        setError(detail)
        setPhase('error')
        return
      }
      setConnectionLost(true)
      setError(connectionInterruptedMessage(detail))
      setPhase('error')
    })
    return () =>{  controller.abort() }
    // Session admission is mount-scoped; ordinary cursor/UI changes must not reconnect the stream.
  }, [input.session.sessionId, input.projectId, input.spaceId, token, reconnectGeneration])

  const send = useCallback(
    async (raw: string, generationContext: GenerationContext, _referenceAssetIds: number[] = []) => {
      const text = raw.trim()
      if (sessionRef.current.activeRun) {
        setError('原任务结果尚未核清，禁止提交新任务；请先恢复或核对原任务。')
        return false
      }
      if (
        text.length === 0 ||
        token === null ||
        phase === 'running' ||
        phase === 'authorizing' ||
        phase === 'cancelling'
      )
        return false
      if (isBrowserOffline()) {
        const offlineHint = sendBlockedOfflineMessage('网络已断开')
        setConnectionLost(false)
        setError(offlineHint)
        setPhase('error')
        return false
      }
      const controller = new AbortController()
      cancelInFlight.current = false
      abortRef.current?.abort()
      abortRef.current = controller
      const assistantId = newMessageId()
      const userMessage: AgentMessage = {
        id: newMessageId(),
        role: 'user',
        text,
        status: 'complete',
        generationContext,
      }
      const assistantMessage: AgentMessage = { id: assistantId, role: 'assistant', text: '', status: 'streaming' }
      update(session => ({
        ...session,
        title: session.messages.length === 0 ? text.slice(0, 28) : session.title,
        workflow: undefined,
        messages: [...session.messages, userMessage, assistantMessage],
        updatedAt: new Date().toISOString(),
      }))
      setError(undefined)
      setConnectionLost(false)
      setPhase('authorizing')
      // If grant/proxy hangs beyond connect budget, force the send path to surface a tip.
      const admitWatchdog = window.setTimeout(() => {
        if (sessionRef.current.activeRun !== undefined) return
        if (phaseRef.current !== 'authorizing') return
        controller.abort()
      }, 12_000)
      let promptSynced = false
      const persistPrompt = async () => {
        if (token === null || promptSynced) return
        const { serverRevision: _ignored, ...sessionWithoutRevision } = sessionRef.current
        await appendUserPrompt({
          token,
          session: sessionWithoutRevision,
          text,
          clientEntryId: userMessage.id,
          signal: controller.signal,
          ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        })
        promptSynced = true
      }
      try {
        try {
          await persistPrompt()
        } catch {
          // Retry after submit so a successful generation still gets a timeline prompt.
        }
        const obtainGrant = async (force = false) => {
          const current = grantRef.current
          if (!force && current !== undefined && Date.parse(current.expiresAt) - Date.now() > 30_000) return current
          const next = await createGrant({
            token,
            sessionId: input.session.sessionId,
            mode: input.session.mode,
            ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
            signal: controller.signal,
          })
          grantRef.current = next
          sessionStorage.setItem(`shotgo-agent-capability-grant:${input.session.sessionId}`, next.grantToken)
          return next
        }
        if (isBrowserOffline()) throw new Error('网络已断开')
        const grant = await obtainGrant()
        if (grant.sessionId !== input.session.sessionId || grant.agentMode !== input.session.mode)
          throw new Error('Agent 授权范围与当前会话不一致')
        if (isBrowserOffline()) throw new Error('网络已断开')
        const accepted = await submitMessage({
          grant: grant.grantToken,
          sessionId: input.session.sessionId,
          mode: input.executionMode,
          text,
          generationContext,
          signal: controller.signal,
        })
        window.clearTimeout(admitWatchdog)
        runRef.current = { runId: accepted.runId, grant: grant.grantToken }
        setPhase('running')
        update(session => ({
          ...session,
          activeRun: { runId: accepted.runId, assistantId, executionMode: input.executionMode,
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
            ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }) },
          streamEpoch: accepted.streamEpoch,
          cursor: session.streamEpoch === accepted.streamEpoch ? session.cursor : 0,
        }))
        let lastApplied = sessionRef.current.cursor
        let settled = false
        await streamRun({
          getGrant: obtainGrant,
          sessionId: input.session.sessionId,
          runId: accepted.runId,
          streamEpoch: accepted.streamEpoch,
          afterCursor: sessionRef.current.cursor,
          signal: controller.signal,
          onCursor: (cursor) => {
            update(session => ({
              ...session,
              cursor: Math.max(session.cursor, cursor),
              updatedAt: new Date().toISOString(),
            }))
          },
          onEvent: (event) => {
            if (controller.signal.aborted || settled || event.sessionId !== input.session.sessionId || event.runId !== accepted.runId
              || event.streamEpoch !== accepted.streamEpoch || event.cursor <= lastApplied) return
            lastApplied = event.cursor
            setConnectionLost(false)
            setError(undefined)
            const workflow = creativeWorkflow(event)
            if (workflow !== undefined)
              update(session =>
                session.workflow && session.workflow.projectRevision > workflow.projectRevision
                  ? session
                  : { ...session, workflow, updatedAt: new Date().toISOString() },
              )
            const revision = creativeRevisionLifecycle(event)
            if (revision !== undefined)
              update(session => ({ ...session, revision, updatedAt: new Date().toISOString() }))
            const decision = exceptionDecision(event)
            if (decision !== undefined) recovery.current?.upsert(decision)
            if (event.type === 'approval.requested')
              handleApprovalRequested(event, input.executionMode)
            if (event.type === 'approval.resolved') {
              const approvalId = event.payload.approvalId
              if (typeof approvalId === 'string' && sessionRef.current.activeRun?.respondedApprovalIds?.includes(approvalId)) setError(undefined)
              if (typeof approvalId === 'string') update(session => ({ ...session, activeRun: session.activeRun ? { ...session.activeRun,
                respondedApprovalIds: [...new Set([...(session.activeRun.respondedApprovalIds ?? []), approvalId])] } : undefined }))
              setPendingRunStart(undefined)
            }
            const delta = assistantDelta(event)
            const artifacts = generationArtifacts(event)
            const generationRefs = generationRefsFromEvent(event)
            if (delta !== undefined || artifacts !== undefined || generationRefs !== undefined) {
              update(session => ({
                ...session,
                messages: session.messages.map((message) => {
                  if (message.id !== assistantId) return message
                  const mergedRefs = generationRefs === undefined
                    ? undefined
                    : mergeGenerationRefs(message.generationRefs, generationRefs)
                  const mergedArtifacts = artifacts === undefined
                    ? undefined
                    : mergeGenerationArtifacts(message.artifacts, artifacts)
                  return {
                    ...message,
                    ...(delta === undefined ? {} : { text: message.text + delta }),
                    ...(mergedArtifacts === undefined ? {} : { artifacts: mergedArtifacts }),
                    ...(mergedRefs === undefined ? {} : { generationRefs: mergedRefs }),
                  }
                }),
                updatedAt: new Date().toISOString(),
              }))
            }
            if (terminal(event, accepted.runId)) {
              settled = true
              setConnectionLost(false)
              setPendingRunStart(undefined)
              if (event.type === 'run.failed') setError(stoppedMessage(event.payload.code))
              const status =
                event.type === 'run.completed' ? 'complete' : event.type === 'run.cancelled' ? 'cancelled' : 'failed'
              update(session => ({
                ...session,
                activeRun: event.type === 'run.failed' ? session.activeRun : undefined,
                workflow: event.type === 'run.completed' ? session.workflow : undefined,
                messages: session.messages.map(message =>
                  message.id === assistantId
                    ? {
                      ...message,
                      status,
                      text:
                          message.text.trim().length > 0
                            ? message.text
                            : status === 'cancelled'
                              ? '本轮已取消。'
                              : status === 'failed'
                                ? '本轮执行失败。'
                                : message.text,
                    }
                    : message,
                ),
                updatedAt: new Date().toISOString(),
              }))
              setPhase(event.type === 'run.failed' ? 'error' : 'idle')
              runRef.current = undefined
            }
          },
        })
        try {
          await persistPrompt()
        } catch {
          // Local cache still has the prompt; sidebar sync warning is handled on next hydrate.
        }
        return true
      } catch (cause) {
        window.clearTimeout(admitWatchdog)
        try {
          await persistPrompt()
        } catch {
          // Keep going; generation error is the user-visible failure.
        }
        const runHang =
          runRef.current !== undefined
          || sessionRef.current.activeRun !== undefined
        if (controller.signal.aborted) {
          if (runHang) {
            setConnectionLost(true)
            setError(connectionInterruptedMessage(isBrowserOffline() ? '网络已断开' : undefined))
            setPhase('error')
            return false
          }
          const offlineHint = sendBlockedOfflineMessage(
            isBrowserOffline() ? '网络已断开' : '连接超时，无法接通 Agent',
          )
          setConnectionLost(false)
          setError(offlineHint)
          setPhase('error')
          update(session => ({
            ...session,
            messages: session.messages.map(item =>
              item.id === assistantId
                ? { ...item, status: 'failed', text: item.text.trim().length > 0 ? item.text : offlineHint }
                : item,
            ),
            updatedAt: new Date().toISOString(),
          }))
          return false
        }
        const message = cause instanceof Error ? cause.message : 'Agent 运行失败'
        if (runHang) {
          if (isPermanentGatewayStreamError(cause)) {
            setConnectionLost(false)
            setError(message)
            setPhase('error')
            return false
          }
          // Stream/network loss after admission: hang UI, never mark the Run failed or resubmit.
          setConnectionLost(true)
          setError(connectionInterruptedMessage(message))
          setPhase('error')
          return false
        }
        const offlineHint = sendBlockedOfflineMessage(message)
        setConnectionLost(false)
        setError(offlineHint)
        setPhase('error')
        update(session => ({
          ...session,
          messages: session.messages.map(item =>
            item.id === assistantId
              ? { ...item, status: 'failed', text: item.text.trim().length > 0 ? item.text : offlineHint }
              : item,
          ),
          updatedAt: new Date().toISOString(),
        }))
        return message.includes('SESSION_BUSY') || message.includes('开新会话') ? 'session-busy' : false
      }
    },
    [handleApprovalRequested, input, phase, token, update],
  )

  const cancel = useCallback(async () => {
    const run = runRef.current
    if (run === undefined || cancelInFlight.current) return
    cancelInFlight.current = true
    setPendingRunStart(undefined)
    setConnectionLost(false)
    setPhase('cancelling')
    try {
      await cancelRun({ grant: run.grant, sessionId: input.session.sessionId, runId: run.runId })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消失败')
      setPhase('running')
      cancelInFlight.current = false
    }
  }, [input.session.sessionId])

  const confirmRunStart = useCallback(
    async (outcome: 'allowed-once' | 'rejected') => {
      const pending = pendingRunStart
      if (pending === undefined) return
      await resolveRunStart(pending, outcome)
    },
    [pendingRunStart, resolveRunStart],
  )

  return {
    phase,
    error,
    connectionLost,
    decisions,
    decisionClient,
    pendingRunStart,
    runStartResponding,
    confirmRunStart,
    send,
    cancel,
    reconnect: () => {
      cancelInFlight.current = false
      setConnectionLost(true)
      setError(current =>
        connectionInterruptedMessage(
          current && current.includes('正在重连') ? current : '连接已中断，正在重连原任务（不会重新提交）…',
        ),
      )
      setReconnectGeneration(value => value + 1)
    },
    setDecisions,
  }
}
