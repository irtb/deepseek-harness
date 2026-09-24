import type { AgentMode, ExecutionMode, GatewayEvent, GenerationContext } from './agent-session.ts'
import { parseGatewayEvent, terminal } from './agent-session.ts'
import { streamGatewayExceptionDecisions } from './gateway-exception-stream.ts'
import {
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
} from './gateway-protocol.ts'
import { apiFetch, gatewayFetch, gatewayStatusMessage } from './network-error.ts'

/** RFC 9562 v4 UUID via getRandomValues (plain-HTTP safe; avoids crypto.randomUUID). */
function newClientRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, index) => {
    const pinned = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte
    return pinned.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function apiBase(): string {
  return String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
}
function gatewayBase(): string {
  return String(import.meta.env.VITE_SHOTGO_GATEWAY_BASE_URL ?? window.location.origin).replace(/\/$/, '')
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    detail?: unknown
    message?: unknown
    code?: unknown
  } | null
  const code = typeof body?.code === 'string' ? body.code : undefined
  const detail =
    typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : undefined
  if (detail !== undefined) return detail
  return gatewayStatusMessage(response.status, code, fallback)
}

export async function createGrant(input: {
  token: string
  sessionId: string
  mode: AgentMode
  spaceId?: string
  projectId?: string
  signal?: AbortSignal
}) {
  const response = await apiFetch(`${apiBase()}/api/agent/v1/grants`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      sessionId: input.sessionId,
      agentMode: input.mode,
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  if (!response.ok) throw new Error(await errorMessage(response, '获取 Agent 授权失败'))
  return response.json() as Promise<{ grantToken: string; expiresAt: string; sessionId: string; agentMode: AgentMode }>
}

export async function submitMessage(input: {
  grant: string
  sessionId: string
  mode: ExecutionMode
  text: string
  generationContext: GenerationContext
  creativeRun?: {
    schemaVersion: 1
    creativeRunId: string
    objective: string
    deliveryTargets: string[]
    sourceRef: string
    businessInput: unknown
  }
  signal?: AbortSignal
}) {
  const clientRequestId = newClientRequestId()
  const response = await gatewayFetch(
    `${gatewayBase()}/api/agent/v1/sessions/${encodeURIComponent(input.sessionId)}/messages`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.grant}`,
        'Idempotency-Key': clientRequestId,
        [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      },
      // Gateway parseMessage allows only clientRequestId/message/generationContext.
      // executionMode and creativeRun are Web-local; sending them yields INVALID_MESSAGE_REQUEST.
      body: JSON.stringify({
        clientRequestId,
        message: { type: 'text', text: input.text },
        generationContext: input.generationContext,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  )
  if (!response.ok) throw new Error(await errorMessage(response, '提交 Agent 消息失败'))
  return response.json() as Promise<{ runId: string; streamEpoch: string }>
}

export async function streamRun(input: {
  getGrant(force: boolean): Promise<{ grantToken: string; expiresAt: string }>
  sessionId: string
  runId: string
  streamEpoch: string
  afterCursor: number
  signal: AbortSignal
  onEvent(event: GatewayEvent): void
  onCursor(cursor: number): void
  onEpoch?(epoch: string): void
}) {
  let cursor = input.afterCursor
  let epoch = input.streamEpoch
  let reconnects = 0
  while (!input.signal.aborted) {
    const grant = await input.getGrant(reconnects > 0)
    let epochBound = input.onEpoch === undefined
    const connectionCursor = cursor
    const streamState = { acceptedTerminal: false }
    const connection = new AbortController()
    const abort = () => {
      connection.abort(input.signal.reason)
    }
    input.signal.addEventListener('abort', abort, { once: true })
    const expiresAt = Date.parse(grant.expiresAt)
    const renewalMs = Number.isFinite(expiresAt) ? Math.max(1_000, expiresAt - Date.now() - 30_000) : 30_000
    let renewal = false
    const timer = window.setTimeout(() => {
      renewal = true
      connection.abort()
    }, renewalMs)
    try {
      await streamGatewayExceptionDecisions({
        gatewayBaseUrl: gatewayBase(),
        sessionId: input.sessionId,
        capabilityGrant: grant.grantToken,
        afterCursor: cursor,
        fetch: gatewayFetch,
        signal: connection.signal,
        onCursor: () => { /* Commit cursors only with a parsed, scoped event below. */ },
        onEvent: (value) => {
          const event = parseGatewayEvent(value)
          if (event === undefined || event.sessionId !== input.sessionId) return
          // Only explicit recovery may bind the first scoped event from the freshly authenticated connection.
          // Gateway cold recovery preserves session cursors while replacing the process stream epoch.
          if (!epochBound && event.cursor > connectionCursor) {
            epoch = event.streamEpoch
            epochBound = true
            input.onEpoch?.(epoch)
          }
          if (event.streamEpoch !== epoch || event.cursor <= cursor) return
          cursor = event.cursor
          input.onCursor(cursor)
          // A retained terminal event from a previous Run closes the Gateway stream.
          // Advance the session cursor before reconnecting to reach the current Run.
          if (event.runId !== input.runId) return
          input.onEvent(event)
          streamState.acceptedTerminal = terminal(event, input.runId)
        },
        stopWhen: () => streamState.acceptedTerminal,
      })
      if (!streamState.acceptedTerminal) throw new Error('Gateway stream closed before terminal event')
      return
    } catch (cause) {
      if (input.signal.aborted) throw cause
      const message = cause instanceof Error ? cause.message : ''
      // Unreachable Gateway should surface hang UI immediately; soft retries stay for
      // grant renewal and cursor catch-up after a prior Run's retained terminal frame.
      if (!renewal && (/无法连接/i.test(message) || cause instanceof TypeError)) throw cause
      if (!renewal && reconnects >= 2) throw cause
      reconnects = renewal ? 0 : reconnects + 1
    } finally {
      window.clearTimeout(timer)
      input.signal.removeEventListener('abort', abort)
    }
  }
}

export async function cancelRun(input: { grant: string; sessionId: string; runId: string }) {
  const response = await gatewayFetch(
    `${gatewayBase()}/api/agent/v1/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.grant}`,
        [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      },
    },
  )
  if (!response.ok) throw new Error(await errorMessage(response, '取消运行失败'))
}

export async function respondRunStart(input: {
  grant: string
  sessionId: string
  approvalId: string
  outcome: 'allowed-once' | 'rejected'
  signal?: AbortSignal
}) {
  const response = await gatewayFetch(
    `${gatewayBase()}/api/agent/v1/sessions/${encodeURIComponent(input.sessionId)}/approvals/${encodeURIComponent(input.approvalId)}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.grant}`,
        [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ outcome: input.outcome }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  )
  if (!response.ok) throw new Error(await errorMessage(response, '响应开始执行确认失败'))
}

export { terminal }
