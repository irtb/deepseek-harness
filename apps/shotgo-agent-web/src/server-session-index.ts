import type { AgentMessage, AgentMode, AgentSessionRecord, GenerationArtifact } from './agent-session.ts'

export type CreativeSessionSummary = {
  sessionId: string
  title: string
  revision: number
  coverUrl: string | null
  createdAt: string
  updatedAt: string
}

export type CreativeGenerationAsset = {
  assetId: string
  kind: string
  url: string
  sizeBytes: number
}

export type CreativeSessionEntry = {
  id: string
  type: 'user_prompt' | 'generation'
  text?: string
  clientEntryId?: string | null
  generationId?: string | null
  clientRequestId?: string | null
  createdAt: string
  generation?: {
    generationId: string
    clientRequestId: string
    state: string
    assets?: CreativeGenerationAsset[]
  }
}

export type CreativeSessionDetail = CreativeSessionSummary & {
  agentMode: AgentMode
  spaceId: string | null
  projectId: string | null
  entries: CreativeSessionEntry[]
}

export class CreativeSessionNotFoundError extends Error {
  constructor() {
    super('CREATIVE_SESSION_NOT_FOUND')
    this.name = 'CreativeSessionNotFoundError'
  }
}

function apiBase(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}

function authHeaders(token: string, json = false): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export function isSensitiveUserText(text: string): boolean {
  return /bearer\s+\S+/i.test(text)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)
    || /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./.test(text)
    || /\bsk-[A-Za-z0-9]{16,}\b/.test(text)
}

export async function fetchServerSessions(
  token: string,
  mode: AgentMode,
  signal?: AbortSignal,
): Promise<CreativeSessionSummary[]> {
  const response = await fetch(`${apiBase()}/api/agent/v1/creative-sessions?agentMode=${mode}`, {
    headers: authHeaders(token),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error('创作记录未能同步')
  const body = (await response.json()) as { sessions?: unknown }
  return Array.isArray(body.sessions) ? body.sessions.filter(isSummary) : []
}

export async function fetchCreativeSessionDetail(
  token: string,
  sessionId: string,
  mode: AgentMode,
  signal?: AbortSignal,
): Promise<CreativeSessionDetail> {
  const response = await fetch(
    `${apiBase()}/api/agent/v1/creative-sessions/${encodeURIComponent(sessionId)}?agentMode=${mode}`,
    {
      headers: authHeaders(token),
      ...(signal === undefined ? {} : { signal }),
    },
  )
  if (response.status === 404) throw new CreativeSessionNotFoundError()
  if (!response.ok) throw new Error('创作记录未能同步')
  const body = (await response.json()) as Record<string, unknown>
  const entries = body.entries
  const agentMode = body.agentMode
  const spaceId = body.spaceId
  const projectId = body.projectId
  if (!isSummary(body) || !Array.isArray(entries)) throw new Error('创作记录未能同步')
  return {
    sessionId: body.sessionId,
    title: body.title,
    revision: body.revision,
    coverUrl: body.coverUrl,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    agentMode: agentMode === 'video' ? 'video' : 'image',
    spaceId: typeof spaceId === 'string' ? spaceId : null,
    projectId: typeof projectId === 'string' ? projectId : null,
    entries: entries.filter(isEntry),
  }
}

export async function saveServerSession(
  token: string,
  session: AgentSessionRecord,
  signal?: AbortSignal,
  context?: { spaceId?: string; projectId?: string },
): Promise<CreativeSessionSummary | undefined> {
  const response = await fetch(`${apiBase()}/api/agent/v1/creative-sessions/${encodeURIComponent(session.sessionId)}`, {
    method: 'PUT',
    headers: authHeaders(token, true),
    body: JSON.stringify({
      agentMode: session.mode,
      title: session.title,
      ...(session.serverRevision === undefined ? {} : { revision: session.serverRevision }),
      ...(context?.spaceId === undefined ? {} : { spaceId: context.spaceId }),
      ...(context?.projectId === undefined ? {} : { projectId: context.projectId }),
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (response.status === 409) throw new Error('创作记录未能同步')
  if (!response.ok) throw new Error('创作记录未能同步')
  const body = (await response.json()) as { session?: unknown }
  return isSummary(body.session) ? body.session : undefined
}

export async function appendUserPrompt(input: {
  token: string
  session: AgentSessionRecord
  text: string
  clientEntryId: string
  signal?: AbortSignal
  spaceId?: string
  projectId?: string
}): Promise<void> {
  if (isSensitiveUserText(input.text)) return
  const post = () =>
    fetch(`${apiBase()}/api/agent/v1/creative-sessions/${encodeURIComponent(input.session.sessionId)}/entries`, {
      method: 'POST',
      headers: authHeaders(input.token, true),
      body: JSON.stringify({
        type: 'user_prompt',
        text: input.text,
        clientEntryId: input.clientEntryId,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  let response = await post()
  if (response.status === 404) {
    await saveServerSession(
      input.token,
      input.session,
      input.signal,
      {
        ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      },
    )
    response = await post()
  }
  if (!response.ok) throw new Error('创作记录未能同步')
}

export async function uploadLocalUserPrompts(
  token: string,
  session: AgentSessionRecord,
  signal?: AbortSignal,
): Promise<void> {
  for (const message of session.messages) {
    if (message.role !== 'user' || message.text.trim() === '' || isSensitiveUserText(message.text)) continue
    await appendUserPrompt({
      token,
      session,
      text: message.text,
      clientEntryId: message.id,
      ...(signal === undefined ? {} : { signal }),
    })
  }
}

export function mergeSessionIndex(
  local: AgentSessionRecord[],
  remote: CreativeSessionSummary[],
  mode: AgentMode,
): AgentSessionRecord[] {
  const localById = new Map(local.map(item => [item.sessionId, item]))
  const merged: AgentSessionRecord[] = remote.map((summary) => {
    const current = localById.get(summary.sessionId)
    if (current === undefined) {
      return emptyFromSummary(summary, mode)
    }
    return {
      ...current,
      title: summary.title,
      updatedAt: summary.updatedAt,
      createdAt: summary.createdAt || current.createdAt,
      serverRevision: summary.revision,
      coverUrl: summary.coverUrl,
    }
  })
  const remoteIds = new Set(remote.map(item => item.sessionId))
  for (const draft of local) {
    if (remoteIds.has(draft.sessionId)) continue
    merged.push(draft)
  }
  return merged.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 50)
}

export function projectCreativeTimeline(
  mode: AgentMode,
  detail: CreativeSessionDetail,
  entries: CreativeSessionEntry[],
  previous?: AgentSessionRecord,
): AgentSessionRecord {
  if (previous?.activeRun !== undefined) {
    return {
      ...previous,
      title: detail.title,
      updatedAt: detail.updatedAt,
      serverRevision: detail.revision,
      coverUrl: detail.coverUrl,
    }
  }
  const messages: AgentMessage[] = []
  for (const entry of entries) {
    if (entry.type === 'user_prompt') {
      messages.push({
        id: entry.id,
        role: 'user',
        text: entry.text ?? '',
        status: 'complete',
      })
      continue
    }
    if (entry.type !== 'generation' || entry.generationId == null || entry.generationId === '') continue
    const assets = artifactsFromEntry(entry, mode)
    messages.push({
      id: entry.id,
      role: 'assistant',
      text: '',
      status: 'complete',
      generationRefs: [{
        generationId: entry.generationId,
        clientRequestId: entry.clientRequestId ?? entry.generation?.clientRequestId ?? '',
        ...(entry.generation?.state === undefined ? {} : { state: entry.generation.state }),
      }],
      ...(assets.length > 0 ? { artifacts: assets } : {}),
    })
  }
  return {
    sessionId: detail.sessionId,
    mode,
    title: detail.title,
    messages,
    cursor: previous?.cursor ?? 0,
    streamEpoch: previous?.streamEpoch ?? null,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    serverRevision: detail.revision,
    coverUrl: detail.coverUrl,
    hydrated: true,
    ...(previous?.workflow === undefined ? {} : { workflow: previous.workflow }),
    ...(previous?.revision === undefined ? {} : { revision: previous.revision }),
  }
}

function emptyFromSummary(summary: CreativeSessionSummary, mode: AgentMode): AgentSessionRecord {
  return {
    sessionId: summary.sessionId,
    mode,
    title: summary.title,
    messages: [],
    cursor: 0,
    streamEpoch: null,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    serverRevision: summary.revision,
    coverUrl: summary.coverUrl,
    hydrated: false,
  }
}

function artifactsFromEntry(entry: CreativeSessionEntry, mode: AgentMode): GenerationArtifact[] {
  const assets = entry.generation?.assets
  if (!Array.isArray(assets) || entry.generationId == null) return []
  return assets.flatMap((asset, index): GenerationArtifact[] => {
    if (typeof asset.url !== 'string' || asset.url === '') return []
    const kind = asset.kind === 'video' ? 'video' : mode
    const assetId = typeof asset.assetId === 'string' && asset.assetId !== '' ? asset.assetId : String(index)
    return [{
      id: `${entry.generationId}:${assetId}`,
      mediaType: kind,
      status: 'succeeded',
      url: asset.url,
      thumbnailUrl: asset.url,
    }]
  })
}

function isSummary(value: unknown): value is CreativeSessionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.sessionId === 'string'
    && typeof item.title === 'string'
    && Number.isSafeInteger(item.revision)
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && (item.coverUrl === null || typeof item.coverUrl === 'string')
  )
}

function isEntry(value: unknown): value is CreativeSessionEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && (item.type === 'user_prompt' || item.type === 'generation') && typeof item.createdAt === 'string'
}
