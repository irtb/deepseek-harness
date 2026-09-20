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

  useEffect(() => {
    const saved = sessionRef.current
    const active = saved.activeRun
    if (!active || !saved.streamEpoch || token === null || typeof active.runId !== 'string'
      || typeof active.assistantId !== 'string' || !['automatic', 'manual'].includes(active.executionMode)) return
    if (active.projectId !== input.projectId || active.spaceId !== input.spaceId) {
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
        setPhase('running')
        const workflow = creativeWorkflow(event)
        if (workflow) update(session => session.workflow && session.workflow.projectRevision > workflow.projectRevision
          ? session : { ...session, workflow })
        const revision = creativeRevisionLifecycle(event)
        if (revision) update(session => ({ ...session, revision }))
        const decision = exceptionDecision(event)
        if (decision) recovery.current?.upsert(decision)
        if (event.type === 'approval.requested' && active.executionMode === 'manual' && typeof event.payload.approvalId === 'string'
          && !sessionRef.current.activeRun?.respondedApprovalIds?.includes(event.payload.approvalId))
          setPendingRunStart({ approvalId: event.payload.approvalId, runId: event.runId })
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
    }).catch(() => { if (!controller.signal.aborted) { setError('恢复连接失败；任务未重新提交，请重试连接。'); setPhase('error') } })
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
      const controller = new AbortController()
      cancelInFlight.current = false
      abortRef.current?.abort()
      abortRef.current = controller
      const assistantId = crypto.randomUUID()
      const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
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
      setPhase('authorizing')
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
        const grant = await obtainGrant()
        if (grant.sessionId !== input.session.sessionId || grant.agentMode !== input.session.mode)
          throw new Error('Agent 授权范围与当前会话不一致')
        const accepted = await submitMessage({
          grant: grant.grantToken,
          sessionId: input.session.sessionId,
          mode: input.executionMode,
          text,
          generationContext,
          signal: controller.signal,
        })
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
            if (event.type === 'approval.requested' && input.executionMode === 'manual') {
              const approvalId = event.payload.approvalId
              if (typeof approvalId === 'string' && !sessionRef.current.activeRun?.respondedApprovalIds?.includes(approvalId))
                setPendingRunStart({
                  approvalId,
                  runId: event.runId,
                  ...(typeof event.payload.reason === 'string' ? { reason: event.payload.reason } : {}),
                })
            }
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
                          message.text ||
                          (status === 'complete'
                            ? '本轮处理已完成。'
                            : status === 'cancelled'
                              ? '本轮已取消。'
                              : '本轮执行失败。'),
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
        try {
          await persistPrompt()
        } catch {
          // Keep going; generation error is the user-visible failure.
        }
        if (controller.signal.aborted) return false
        const message = cause instanceof Error ? cause.message : 'Agent 运行失败'
        setError(message)
        setPhase('error')
        update(session => ({
          ...session,
          messages: session.messages.map(item =>
            item.id === assistantId ? { ...item, status: 'failed', text: item.text || message } : item,
          ),
          updatedAt: new Date().toISOString(),
        }))
        return message.includes('SESSION_BUSY') || message.includes('开新会话') ? 'session-busy' : false
      }
    },
    [input, phase, token, update],
  )

  const cancel = useCallback(async () => {
    const run = runRef.current
    if (run === undefined || cancelInFlight.current) return
    cancelInFlight.current = true
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
      const run = runRef.current
      const signal = abortRef.current?.signal
      if (
        pending === undefined ||
        run === undefined ||
        signal === undefined ||
        run.runId !== pending.runId ||
        runStartResponding || responseInFlight.current || sessionRef.current.activeRun?.respondedApprovalIds?.includes(pending.approvalId)
      )
        return
      setRunStartResponding(true)
      responseInFlight.current = true
      try {
        // Persist intent before sending: a lost response must never unlock a second approval POST.
        update(session => ({ ...session,
          activeRun: session.activeRun?.runId === pending.runId ? { ...session.activeRun,
            respondedApprovalIds: [...new Set([...(session.activeRun.respondedApprovalIds ?? []), pending.approvalId])],
          } : session.activeRun }))
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
    [input.session.sessionId, pendingRunStart, runStartResponding, update],
  )

  return {
    phase,
    error,
    decisions,
    decisionClient,
    pendingRunStart,
    runStartResponding,
    confirmRunStart,
    send,
    cancel,
    reconnect: () => { cancelInFlight.current = false; setReconnectGeneration(value => value + 1) },
    setDecisions,
  }
}
