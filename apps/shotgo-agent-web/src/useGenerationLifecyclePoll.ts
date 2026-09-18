import { useEffect, useRef } from 'react'
import type { AgentMode, AgentSessionRecord, GenerationArtifact, GenerationRef } from './agent-session.ts'
import { createGrant } from './gateway-client.ts'
import {
  artifactBelongsToGeneration,
  fetchGenerationLifecycle,
  GenerationLifecycleNotFoundError,
  isGenerationRenderSettled,
} from './generation-lifecycle.ts'
import { resolvedGenerationRefs } from './message-artifacts.ts'

const POLL_MS = 2500

function pendingRefs(session: AgentSessionRecord): Array<{ messageId: string; ref: GenerationRef }> {
  const out: Array<{ messageId: string; ref: GenerationRef }> = []
  for (const message of session.messages) {
    if (message.role !== 'assistant') continue
    const refs = resolvedGenerationRefs(message)
    if (refs.length === 0) continue
    for (const ref of refs) {
      if (isGenerationRenderSettled(message.artifacts, ref.generationId, ref.state)) continue
      out.push({ messageId: message.id, ref })
    }
  }
  return out
}

function mergeArtifacts(
  existing: GenerationArtifact[] | undefined,
  next: GenerationArtifact[],
  generationId: string,
): GenerationArtifact[] {
  const nextBareIds = new Set(
    next
      .map((item) => {
        const split = item.id.indexOf(':')
        return split === -1 ? undefined : item.id.slice(split + 1)
      })
      .filter((value): value is string => value !== undefined && value.length > 0),
  )
  const kept = (existing ?? []).filter((item) => {
    if (artifactBelongsToGeneration(item.id, generationId)) return false
    if (nextBareIds.has(item.id)) return false
    return true
  })
  return [...kept, ...next]
}

function placeholder(generationId: string, mode: AgentMode, state: string): GenerationArtifact {
  const status: GenerationArtifact['status'] =
    state === 'failed' || state === 'cancelled'
      ? 'failed'
      : state === 'queued'
        ? 'queued'
        : 'processing'
  return { id: generationId, mediaType: mode, status }
}

function sameArtifacts(a: GenerationArtifact[] | undefined, b: GenerationArtifact[]): boolean {
  if ((a?.length ?? 0) !== b.length) return false
  return b.every((item, index) => {
    const prev = a?.[index]
    if (prev === undefined) return false
    return prev.id === item.id && prev.status === item.status && prev.url === item.url && prev.mediaType === item.mediaType
  })
}

/** Poll Laravel generation lifecycle until assets are renderable, then merge onto assistant messages. */
export function useGenerationLifecyclePoll(input: {
  token: string | null
  session: AgentSessionRecord
  mode: AgentMode
  spaceId?: string
  projectId?: string
  onSessionChange: (session: AgentSessionRecord) => void
}) {
  const sessionRef = useRef(input.session)
  const onChangeRef = useRef(input.onSessionChange)
  sessionRef.current = input.session
  onChangeRef.current = input.onSessionChange

  useEffect(() => {
    const accessToken = input.token
    if (accessToken === null) return
    const controller = new AbortController()
    let timer: number | undefined
    let inFlight = false
    let cachedGrant: { token: string; expiresAt: number } | undefined

    const schedule = () => {
      if (controller.signal.aborted) return
      timer = window.setTimeout(() => {
        void tick()
      }, POLL_MS)
    }

    const obtainGrant = async () => {
      if (cachedGrant !== undefined && cachedGrant.expiresAt - Date.now() > 30_000) return cachedGrant.token
      const grant = await createGrant({
        token: accessToken,
        sessionId: sessionRef.current.sessionId,
        mode: input.mode,
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        signal: controller.signal,
      })
      cachedGrant = { token: grant.grantToken, expiresAt: Date.parse(grant.expiresAt) }
      return grant.grantToken
    }

    const tick = async () => {
      if (controller.signal.aborted || inFlight) return
      const targets = pendingRefs(sessionRef.current)
      if (targets.length === 0) {
        schedule()
        return
      }
      inFlight = true
      try {
        const grantToken = await obtainGrant()
        for (const target of targets) {
          if (controller.signal.aborted) break
          try {
            const status = await fetchGenerationLifecycle({
              token: accessToken,
              sessionId: sessionRef.current.sessionId,
              mode: input.mode,
              generationId: target.ref.generationId,
              ...(target.ref.clientRequestId ? { clientRequestId: target.ref.clientRequestId } : {}),
              grantToken,
              ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
              ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
              signal: controller.signal,
            })
            if (controller.signal.aborted) break
            const assets =
              status.assets.length > 0
                ? status.assets.map(item => ({
                  ...item,
                  mediaType: (item.mediaType === 'video' ? 'video' : input.mode) as AgentMode,
                }))
                : [placeholder(status.generationId, input.mode, status.state)]

            const current = sessionRef.current
            const message = current.messages.find(item => item.id === target.messageId)
            if (message === undefined) continue
            const nextArtifacts = mergeArtifacts(message.artifacts, assets, status.generationId)
            const nextRefs = (message.generationRefs ?? resolvedGenerationRefs(message)).map((ref) => {
              const sameGen =
                ref.generationId === status.generationId
                || ref.generationId === target.ref.generationId
                || (status.clientRequestId !== '' && ref.clientRequestId === status.clientRequestId)
              return sameGen
                ? {
                  generationId: status.generationId,
                  clientRequestId: status.clientRequestId || ref.clientRequestId,
                  state: status.state,
                }
                : ref
            })
            const refsUnchanged =
              JSON.stringify(message.generationRefs ?? []) === JSON.stringify(nextRefs)
            if (sameArtifacts(message.artifacts, nextArtifacts) && refsUnchanged) continue

            onChangeRef.current({
              ...current,
              updatedAt: new Date().toISOString(),
              messages: current.messages.map((item) => {
                if (item.id !== target.messageId) return item
                return {
                  ...item,
                  artifacts: nextArtifacts,
                  generationRefs: nextRefs,
                }
              }),
            })
          } catch (error) {
            if (error instanceof GenerationLifecycleNotFoundError) {
              const current = sessionRef.current
              const message = current.messages.find(item => item.id === target.messageId)
              if (message === undefined) continue
              const absentId = target.ref.generationId
              const nextArtifacts = mergeArtifacts(
                message.artifacts,
                [{
                  id: absentId,
                  mediaType: input.mode,
                  status: 'failed',
                  error: '未创建',
                }],
                absentId,
              )
              const baseRefs = message.generationRefs ?? resolvedGenerationRefs(message)
              const nextRefs = baseRefs.map(ref =>
                ref.generationId === target.ref.generationId || ref.clientRequestId === target.ref.clientRequestId
                  ? { ...ref, state: 'not_found' }
                  : ref,
              )
              onChangeRef.current({
                ...current,
                updatedAt: new Date().toISOString(),
                messages: current.messages.map((item) => {
                  if (item.id !== target.messageId) return item
                  return {
                    ...item,
                    artifacts: nextArtifacts,
                    generationRefs: nextRefs,
                  }
                }),
              })
              continue
            }
            cachedGrant = undefined
          }
        }
      } catch {
        cachedGrant = undefined
      } finally {
        inFlight = false
        schedule()
      }
    }

    void tick()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [input.token, input.mode, input.spaceId, input.projectId, input.session.sessionId])
}
