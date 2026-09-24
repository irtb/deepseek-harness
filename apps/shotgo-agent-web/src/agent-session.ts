import type { ExceptionDecision } from './exception-decision.ts'
import type { ShotGoGatewayProtocolVersion } from './gateway-protocol.ts'
import { isShotGoGatewayProtocolVersion } from './gateway-protocol.ts'

export type AgentMode = 'image' | 'video'
export type ExecutionMode = 'automatic' | 'manual'
export type SessionPhase = 'idle' | 'authorizing' | 'running' | 'cancelling' | 'error'

export interface GenerationContext {
  schemaVersion: 1
  kind: AgentMode
  modelId: string
  parameters: {
    aspectRatioId?: string
    resolutionId?: string
    qualityId?: string
    duration?: number
    audio?: boolean
    referenceAssets?: Array<{ mediaLibraryItemId: number }>
  }
}

export interface GenerationArtifact {
  id: string
  mediaType: AgentMode
  status: 'queued' | 'processing' | 'succeeded' | 'failed'
  url?: string
  thumbnailUrl?: string
  error?: string
}

export interface GenerationRef {
  generationId: string
  clientRequestId: string
  state?: string
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  status: 'complete' | 'streaming' | 'cancelled' | 'failed'
  generationContext?: GenerationContext
  artifacts?: GenerationArtifact[]
  generationRefs?: GenerationRef[]
}

export interface AgentSessionRecord {
  activeRun?: {
    runId: string
    assistantId: string
    executionMode: ExecutionMode
    projectId?: string
    spaceId?: string
    respondedApprovalIds?: string[]
  } | undefined
  sessionId: string
  mode: AgentMode
  title: string
  messages: AgentMessage[]
  cursor: number
  streamEpoch: string | null
  createdAt: string
  updatedAt: string
  coverUrl?: string | null
  serverRevision?: number
  hydrated?: boolean
  workflow?: CreativeWorkflowProjection | undefined
  revision?: CreativeRevisionLifecycleProjection
}

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'needs-revision'
export interface CreativeWorkflowProjection {
  version: 1 | 2 | 3
  uat?: {
    acceptance: 'synthetic-engineering-only'
    sessionId: string
    projectId: string
    mode: ExecutionMode
    skillReleaseId: string
    sourceDigest: string
    hardConstraintCount: number
    softPreferenceCount: number
    planDiff: Array<{ field: 'softPreferences'; operation: 'remove'; valueDigest: string }>
    cost: {
      unit: 'credits'
      quoted: number | null
      actual: number | null
      remaining: number | null
      authority?: { profile: 'synthetic-cost-v1'; digest: string; budgetRef: string; observedAt: string; opening: number }
    }
    details?: {
      briefRef: string
      planRef: string
      hardConstraintDigests: string[]
      softPreferenceDigests: string[]
      startedAt: string
      completedAt: string | null
      elapsedMs: number | null
      stopReason: 'none' | 'quality-failed' | 'cancelled' | 'execution-stopped'
      repairRunRefs: string[]
      gateVersions: Array<{ gateId: string; version: string | null }>
    }
    gates: Array<{ gateId: string; status: 'passed' | 'failed' | 'inconclusive' | 'unavailable'; resultDigest: string | null }>
    delivery: { status: 'unavailable' | 'ready'; digest: string | null }
  }
  creativeRunId: string
  projectRevision: number
  runStatus: WorkflowStatus
  stages: Array<{
    id: string
    definitionId: string
    title: string
    status: WorkflowStatus
    actions: Array<{
      id: string
      definitionId: string
      title: string
      status: WorkflowStatus
      attemptCount: number
      latestAttemptStatus?: 'running' | 'completed' | 'failed' | 'cancelled'
    }>
  }>
  artifacts: Array<{
    id: string
    kind: 'image' | 'video' | 'audio' | 'file' | 'report'
    status: 'available' | 'approved' | 'revision-required' | 'rejected' | 'invalidated'
    stageId: string
    actionId: string
  }>
}

export type CreativeRevisionLifecycleStatus =
  | 'evaluation-failed'
  | 'revision-planned'
  | 'revision-running'
  | 'awaiting-run-start'
  | 'blocked'
  | 'completed'
export interface CreativeRevisionLifecycleProjection {
  eventType: 'creative-project.revision-lifecycle'
  fixtureId: string
  sourceCreativeRunId: string
  revisionCreativeRunId: string
  sourceEvaluationDigest: string
  revisionPlanDigest: string
  status: CreativeRevisionLifecycleStatus
  confirmationRequired: boolean
  reason?: string
}

export interface GatewayEvent {
  protocolVersion: ShotGoGatewayProtocolVersion
  cursor: number
  streamEpoch: string
  sessionId: string
  runId: string
  agentMode: 'canvas' | AgentMode
  occurredAt: string
  type:
    | 'run.accepted'
    | 'session.event'
    | 'approval.requested'
    | 'approval.resolved'
    | 'run.completed'
    | 'run.cancelled'
    | 'run.failed'
  payload: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function parseGatewayEvent(value: unknown): GatewayEvent | undefined {
  const event = record(value)
  if (
    event === undefined ||
    !isShotGoGatewayProtocolVersion(event.protocolVersion) ||
    !Number.isSafeInteger(event.cursor) ||
    typeof event.streamEpoch !== 'string' ||
    typeof event.sessionId !== 'string' ||
    typeof event.runId !== 'string' ||
    (event.agentMode !== 'canvas' && event.agentMode !== 'image' && event.agentMode !== 'video') ||
    typeof event.occurredAt !== 'string' ||
    typeof event.type !== 'string' ||
    record(event.payload) === undefined
  )
    return undefined
  return event as unknown as GatewayEvent
}

export function creativeWorkflow(event: GatewayEvent): CreativeWorkflowProjection | undefined {
  if (event.type !== 'session.event') return undefined
  const workflow = parseCreativeWorkflow(event.payload.workflow)
  return workflow?.uat && workflow.uat.sessionId !== event.sessionId ? undefined : workflow
}

export function creativeRevisionLifecycle(event: GatewayEvent): CreativeRevisionLifecycleProjection | undefined {
  if (event.type !== 'session.event') return undefined
  return parseCreativeRevisionLifecycle(event.payload)
}

export function parseCreativeRevisionLifecycle(input: unknown): CreativeRevisionLifecycleProjection | undefined {
  const value = record(input)
  if (
    !value ||
    value.eventType !== 'creative-project.revision-lifecycle' ||
    ![
      'evaluation-failed',
      'revision-planned',
      'revision-running',
      'awaiting-run-start',
      'blocked',
      'completed',
    ].includes(String(value.status)) ||
    !['fixtureId', 'sourceCreativeRunId', 'revisionCreativeRunId'].every(
      key => typeof value[key] === 'string' && value[key].length > 0,
    ) ||
    ![value.sourceEvaluationDigest, value.revisionPlanDigest].every(
      digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest),
    ) ||
    typeof value.confirmationRequired !== 'boolean' ||
    (value.reason !== undefined && typeof value.reason !== 'string')
  )
    return undefined
  return value as unknown as CreativeRevisionLifecycleProjection
}

export function parseCreativeWorkflow(input: unknown): CreativeWorkflowProjection | undefined {
  const value = record(input)
  if (value?.version === 2 || value?.version === 3) {
    const base = parseCreativeWorkflow({ ...value, version: 1 })
    const uat = parseUatWorkflow(value.uat, value.version)
    if (!base || !uat || (uat.delivery.status === 'ready' && base.runStatus !== 'completed')) return undefined
    return { ...base, version: value.version, uat }
  }
  if (
    !value ||
    value.version !== 1 ||
    typeof value.creativeRunId !== 'string' ||
    !Number.isSafeInteger(value.projectRevision) ||
    !status(value.runStatus) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.artifacts)
  )
    return undefined
  const stages = value.stages.flatMap((stageValue) => {
    const stage = record(stageValue)
    if (
      !stage ||
      typeof stage.id !== 'string' ||
      typeof stage.definitionId !== 'string' ||
      typeof stage.title !== 'string' ||
      !status(stage.status) ||
      !Array.isArray(stage.actions)
    )
      return []
    const actions = stage.actions.flatMap((actionValue) => {
      const action = record(actionValue)
      if (
        !action ||
        typeof action.id !== 'string' ||
        typeof action.definitionId !== 'string' ||
        typeof action.title !== 'string' ||
        !status(action.status) ||
        !Number.isSafeInteger(action.attemptCount) ||
        Number(action.attemptCount) < 0 ||
        (action.latestAttemptStatus !== undefined &&
          !['running', 'completed', 'failed', 'cancelled'].includes(String(action.latestAttemptStatus)))
      )
        return []
      return [action as unknown as CreativeWorkflowProjection['stages'][number]['actions'][number]]
    })
    if (actions.length !== stage.actions.length) return []
    return [{ ...stage, actions } as unknown as CreativeWorkflowProjection['stages'][number]]
  })
  const artifacts = value.artifacts.flatMap((artifactValue) => {
    const artifact = record(artifactValue)
    if (
      !artifact ||
      typeof artifact.id !== 'string' ||
      !['image', 'video', 'audio', 'file', 'report'].includes(String(artifact.kind)) ||
      !['available', 'approved', 'revision-required', 'rejected', 'invalidated'].includes(String(artifact.status)) ||
      typeof artifact.stageId !== 'string' ||
      typeof artifact.actionId !== 'string'
    )
      return []
    return [artifact as unknown as CreativeWorkflowProjection['artifacts'][number]]
  })
  if (stages.length !== value.stages.length || artifacts.length !== value.artifacts.length) return undefined
  return {
    version: 1,
    creativeRunId: value.creativeRunId,
    projectRevision: Number(value.projectRevision),
    runStatus: value.runStatus,
    stages,
    artifacts,
  }
}

function parseUatWorkflow(input: unknown, version: 2 | 3): CreativeWorkflowProjection['uat'] {
  const value = record(input)
  const exact = (row: Record<string, unknown> | undefined, keys: string[]) =>
    row !== undefined && Object.keys(row).sort().join('|') === [...keys].sort().join('|')
  const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
  const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(v)
  if (!value || !exact(value, ['acceptance','sessionId','projectId','mode','skillReleaseId','sourceDigest',
    'hardConstraintCount','softPreferenceCount','planDiff','cost','gates','delivery', ...(version === 3 ? ['details'] : [])])
    || value.acceptance !== 'synthetic-engineering-only' || !['automatic','manual'].includes(String(value.mode))
    || ![value.sessionId,value.projectId,value.skillReleaseId].every(id) || !digest(value.sourceDigest)
    || ![value.hardConstraintCount,value.softPreferenceCount].every(v => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 256)
    || !Array.isArray(value.planDiff) || value.planDiff.length > 256
    || value.planDiff.some((v) => { const row = record(v); return !exact(row, ['field','operation','valueDigest'])
      || row?.field !== 'softPreferences' || row.operation !== 'remove' || !digest(row.valueDigest) })) return undefined
  const cost = record(value.cost), delivery = record(value.delivery)
  const gateIds = ['media','script-audio','text-risk','visual','claim-boundary']
  const authority = record(cost?.authority)
  const amount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v))
  if (!exact(cost, ['unit','quoted','actual','remaining', ...(authority && version === 3 ? ['authority'] : [])]) || cost?.unit !== 'credits'
    || (authority ? version !== 3 || !exact(authority, ['profile','digest','budgetRef','observedAt','opening'])
      || authority.profile !== 'synthetic-cost-v1' || !digest(authority.digest) || !id(authority.budgetRef) || !time(authority.observedAt)
      || !amount(authority.opening) || !amount(cost.actual) || !amount(cost.remaining) || !amount(cost.quoted)
      || authority.opening - cost.actual !== cost.remaining : cost.actual !== null || cost.remaining !== null)
    || !(cost.quoted === null || (typeof cost.quoted === 'number' && Number.isFinite(cost.quoted) && cost.quoted >= 0))
    || !Array.isArray(value.gates) || value.gates.length !== 5
    || value.gates.some((v, i) => { const row = record(v); return !row || !exact(row, ['gateId','status','resultDigest'])
      || row.gateId !== gateIds[i] || !['passed','failed','inconclusive','unavailable'].includes(String(row.status))
      || (row.status === 'unavailable' ? row.resultDigest !== null : !digest(row.resultDigest)) })
    || !exact(delivery, ['status','digest']) || !['ready','unavailable'].includes(String(delivery?.status))
    || (delivery?.status === 'ready' ? !digest(delivery.digest) || value.gates.some(v => record(v)?.status !== 'passed') : delivery?.digest !== null)) return undefined
  if (version === 3) {
    if (authority && delivery?.status !== 'ready') return undefined
    const details = record(value.details)
    if (!details || !exact(details, ['briefRef','planRef','hardConstraintDigests','softPreferenceDigests',
      'startedAt','completedAt','elapsedMs','stopReason','repairRunRefs','gateVersions'])
      || !id(details.briefRef) || !id(details.planRef) || !time(details.startedAt)
      || (details.completedAt === null ? details.elapsedMs !== null : !time(details.completedAt)
        || !amount(details.elapsedMs) || details.elapsedMs !== Date.parse(details.completedAt) - Date.parse(details.startedAt))
      || !['none','quality-failed','cancelled','execution-stopped'].includes(String(details.stopReason))
      || !Array.isArray(details.hardConstraintDigests) || details.hardConstraintDigests.length !== value.hardConstraintCount
      || !details.hardConstraintDigests.every(digest)
      || !Array.isArray(details.softPreferenceDigests) || details.softPreferenceDigests.length !== value.softPreferenceCount
      || !details.softPreferenceDigests.every(digest)
      || !Array.isArray(details.repairRunRefs) || details.repairRunRefs.length > 2 || !details.repairRunRefs.every(id)
      || new Set(details.repairRunRefs).size !== details.repairRunRefs.length
      || !Array.isArray(details.gateVersions) || details.gateVersions.length !== 5
      || details.gateVersions.some((entry, i) => { const row = record(entry); return !row || !exact(row, ['gateId','version'])
        || row.gateId !== gateIds[i] || (record(value.gates instanceof Array ? value.gates[i] : undefined)?.status === 'unavailable'
        ? row.version !== null : row.version !== '1.0.0') })
      || (delivery?.status === 'ready' && (!authority || details.stopReason !== 'none' || details.completedAt === null))) return undefined
  }
  // Exact-key validation precedes copying so persisted UI state cannot retain private nested fields.
  return structuredClone(value) as unknown as NonNullable<CreativeWorkflowProjection['uat']>
}

function status(value: unknown): value is WorkflowStatus {
  return ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'needs-revision'].includes(String(value))
}

export function assistantDelta(event: GatewayEvent): string | undefined {
  if (event.type !== 'session.event') return undefined
  const sessionEvent = record(event.payload.event)
  const data = record(sessionEvent?.data)
  if (sessionEvent?.type === 'assistant/chunk') {
    const chunk = record(data?.chunk)
    return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : undefined
  }
  if (sessionEvent?.type !== 'assistant/message') return undefined
  const message = record(data?.message)
  const content = message?.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .map((block) => {
      const item = record(block)
      return item?.type === 'text' && typeof item.text === 'string' ? item.text : ''
    })
    .join('')
  return text.length > 0 ? text : undefined
}

export function generationArtifacts(event: GatewayEvent): GenerationArtifact[] | undefined {
  if (event.type !== 'session.event') return undefined
  const source = event.payload.artifacts ?? record(event.payload.event)?.data
  const sourceRecord = record(source)
  const values = Array.isArray(source)
    ? source
    : sourceRecord !== undefined && Array.isArray(sourceRecord.artifacts)
      ? sourceRecord.artifacts
      : undefined
  if (!Array.isArray(values)) return undefined
  const parsed = values.flatMap((value): GenerationArtifact[] => {
    const item = record(value)
    if (
      item === undefined ||
      typeof item.id !== 'string' ||
      (item.mediaType !== 'image' && item.mediaType !== 'video') ||
      !['queued', 'processing', 'succeeded', 'failed'].includes(String(item.status))
    )
      return []
    return [
      {
        id: item.id,
        mediaType: item.mediaType,
        status: item.status as GenerationArtifact['status'],
        ...(typeof item.url === 'string' ? { url: item.url } : {}),
        ...(typeof item.thumbnailUrl === 'string' ? { thumbnailUrl: item.thumbnailUrl } : {}),
        ...(typeof item.error === 'string' ? { error: item.error } : {}),
      },
    ]
  })
  return parsed.length > 0 ? parsed : undefined
}

function readGenerationRef(value: unknown): GenerationRef | undefined {
  const item = record(value)
  if (
    item === undefined ||
    typeof item.generationId !== 'string' ||
    item.generationId.length === 0 ||
    typeof item.clientRequestId !== 'string' ||
    item.clientRequestId.length === 0
  ) {
    return undefined
  }
  return {
    generationId: item.generationId,
    clientRequestId: item.clientRequestId,
    ...(typeof item.state === 'string' ? { state: item.state } : {}),
  }
}

function collectGenerationRefs(value: unknown, into: GenerationRef[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') && trimmed.includes('generationId')) {
      try {
        collectGenerationRefs(JSON.parse(trimmed) as unknown, into)
      } catch {
        // Ignore non-JSON tool text; IDs still appear in structured tool results.
      }
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGenerationRefs(item, into)
    return
  }
  const item = record(value)
  if (item === undefined) return
  const direct = readGenerationRef(item)
  if (direct) into.push(direct)
  for (const nested of Object.values(item)) collectGenerationRefs(nested, into)
}

/** Reads generationId/clientRequestId from generation tool results projected on the Gateway stream. */
export function generationRefsFromEvent(event: GatewayEvent): GenerationRef[] | undefined {
  if (event.type !== 'session.event') return undefined
  const found: GenerationRef[] = []
  collectGenerationRefs(event.payload, found)
  if (found.length === 0) return undefined
  const unique = new Map<string, GenerationRef>()
  for (const item of found) unique.set(`${item.generationId}\0${item.clientRequestId}`, item)
  return [...unique.values()]
}

export function mergeGenerationRefs(
  current: GenerationRef[] | undefined,
  next: GenerationRef[] | undefined,
): GenerationRef[] | undefined {
  if (next === undefined || next.length === 0) return current
  const unique = new Map<string, GenerationRef>()
  for (const item of current ?? []) unique.set(`${item.generationId}\0${item.clientRequestId}`, item)
  for (const item of next) unique.set(`${item.generationId}\0${item.clientRequestId}`, item)
  return [...unique.values()]
}

/** Merge SSE/poll artifacts by id so multi-generation cards accumulate instead of replacing. */
export function mergeGenerationArtifacts(
  current: GenerationArtifact[] | undefined,
  next: GenerationArtifact[] | undefined,
): GenerationArtifact[] | undefined {
  if (next === undefined || next.length === 0) return current
  const unique = new Map<string, GenerationArtifact>()
  for (const item of current ?? []) unique.set(item.id, item)
  for (const item of next) unique.set(item.id, item)
  return [...unique.values()]
}

/** Fallback for already-rendered assistant text that embeds Laravel generation identifiers. */
export function generationRefsFromText(text: string): GenerationRef[] | undefined {
  const refs: GenerationRef[] = []
  const seen = new Set<string>()

  const push = (ref: GenerationRef) => {
    const key = `${ref.generationId}\0${ref.clientRequestId}`
    if (seen.has(key) || seen.has(ref.generationId)) return
    seen.add(key)
    seen.add(ref.generationId)
    refs.push(ref)
  }

  for (const match of text.matchAll(/GENERATION_OUTCOME_UNKNOWN[^\n]{0,120}?clientRequestId[=:\s]+(gen-[a-f0-9]+)/gi)) {
    const clientRequestId = match[1]
    if (clientRequestId === undefined) continue
    push({ generationId: clientRequestId, clientRequestId, state: 'reconciling' })
  }

  const generationIds = [
    ...text.matchAll(/生成任务编号[^\d]{0,40}(\d+)/g),
    ...text.matchAll(/\|\s*生成任务编号\s*\|\s*\*{0,2}(\d+)/g),
    ...text.matchAll(/任务\s+(\d+)\s+正在生成/g),
    ...text.matchAll(/generationId["'：:\s]+(\d+)/gi),
  ].flatMap(match => (match[1] === undefined ? [] : [match[1]]))

  const clientRequestIds = [
    ...text.matchAll(/客户端请求号[^`\n|]{0,40}`?(gen-[a-f0-9]+)/gi),
    ...text.matchAll(/clientRequestId["'：:\s]+(gen-[a-f0-9]+)/gi),
    ...text.matchAll(/`(gen-[a-f0-9]{12,})`/gi),
  ].flatMap(match => (match[1] === undefined ? [] : [match[1]]))

  const uniqueIds = [...new Set(generationIds)]
  for (let index = 0; index < uniqueIds.length; index += 1) {
    const generationId = uniqueIds[index]
    if (generationId === undefined) continue
    const clientRequestId = clientRequestIds[index]
    push({
      generationId,
      clientRequestId: clientRequestId && clientRequestId.length > 0 ? clientRequestId : `pending-${generationId}`,
    })
  }

  return refs.length > 0 ? refs : undefined
}

export function exceptionDecision(event: GatewayEvent): ExceptionDecision | undefined {
  if (event.type !== 'session.event' || event.payload.eventType !== 'exception.decision') return undefined
  return record(event.payload.exceptionDecision) as unknown as ExceptionDecision | undefined
}

export function terminal(event: GatewayEvent, runId: string): boolean {
  return (
    event.runId === runId &&
    (event.type === 'run.completed' || event.type === 'run.cancelled' || event.type === 'run.failed')
  )
}
