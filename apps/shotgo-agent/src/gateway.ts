import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  type ShotGoGatewayProtocolVersion,
  type GatewayApprovalResponse,
  type GatewayMessageRequest,
  type GatewayRunAccepted,
} from './contracts/gateway-v1.ts'
import { SHOTGO_PROTOCOL_HEADER, SHOTGO_PROTOCOL_VERSION } from './contracts/laravel-v1.ts'
import { GatewaySessionError } from './gateway-errors.ts'
import type { GatewaySessionService } from './gateway-transport.ts'

export interface GatewayConfig {
  host: '127.0.0.1' | '::1'
  port: number
  trafficEnabled: boolean
  deploymentId: string
  canvasOrigin: string
  laravel?: {
    baseURL: string
    serviceToken: string
  }
}

export interface GatewayReadiness {
  isInferenceRuntimeReady: () => boolean
}

export interface GatewayStatus {
  service: 'shotgo-agent'
  protocolVersion: typeof SHOTGO_PROTOCOL_VERSION
  deploymentId: string
  status: 'ok' | 'not_ready'
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  gatewayProtocolVersion: ShotGoGatewayProtocolVersion = SHOTGO_GATEWAY_PROTOCOL_VERSION,
): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-ShotGo-Protocol-Version': SHOTGO_PROTOCOL_VERSION,
    [SHOTGO_GATEWAY_PROTOCOL_HEADER]: gatewayProtocolVersion,
  })
  response.end(JSON.stringify(body))
}

function reportRequestFailure(request: IncomingMessage, url: URL, error: unknown): void {
  const known = error instanceof GatewaySessionError
  const message = error instanceof Error ? error.message.slice(0, 512) : 'unknown gateway error'
  process.stderr.write(`${JSON.stringify({
    event: 'gateway/request-failed',
    method: request.method ?? 'UNKNOWN',
    path: url.pathname,
    status: known ? error.status : 500,
    code: known ? error.code : 'INTERNAL_ERROR',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    message,
  })}\n`)
}

const CORS_ALLOW_HEADERS = `Authorization, Content-Type, Idempotency-Key, Last-Event-ID, ${SHOTGO_GATEWAY_PROTOCOL_HEADER}`
const CORS_ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS'
const CORS_EXPOSE_HEADERS = `${SHOTGO_PROTOCOL_HEADER}, ${SHOTGO_GATEWAY_PROTOCOL_HEADER}`

function applySessionCors(request: IncomingMessage, response: ServerResponse, allowedOrigin: string): void {
  const header = request.headers.origin
  const origin = typeof header === 'string' ? header : undefined
  if (origin !== undefined && origin !== allowedOrigin) throw new GatewaySessionError('ORIGIN_NOT_ALLOWED', 403)
  if (origin === undefined) return
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  response.setHeader('Access-Control-Allow-Methods', CORS_ALLOW_METHODS)
  response.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS)
  response.setHeader('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS)
  response.setHeader('Vary', 'Origin')
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? ''
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (match === null) throw new GatewaySessionError('CAPABILITY_GRANT_REQUIRED', 401)
  return match[1] as string
}

function requestedGatewayProtocol(request: IncomingMessage): ShotGoGatewayProtocolVersion {
  const value = request.headers[SHOTGO_GATEWAY_PROTOCOL_HEADER.toLowerCase()]
  const version = Array.isArray(value) ? value[0] : value
  if (version === undefined || version === '') return SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION
  if (version !== SHOTGO_GATEWAY_PROTOCOL_VERSION
    && version !== SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION
    && version !== SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION
  ) {
    throw new GatewaySessionError('GATEWAY_PROTOCOL_UNSUPPORTED', 426)
  }
  return version
}

function parseCursor(request: IncomingMessage, url: URL): number {
  const value = request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0'
  const raw = Array.isArray(value) ? value[0] : value
  const cursor = Number(raw)
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new GatewaySessionError('SSE_CURSOR_INVALID', 400)
  return cursor
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    let buffer: Buffer
    if (typeof chunk === 'string') buffer = Buffer.from(chunk)
    else if (chunk instanceof Uint8Array) buffer = Buffer.from(chunk)
    else throw new GatewaySessionError('INVALID_REQUEST_BODY', 400)
    size += buffer.length
    if (size > 64 * 1024) throw new GatewaySessionError('REQUEST_BODY_TOO_LARGE', 413)
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new GatewaySessionError('INVALID_JSON', 400)
  }
}

function parseMessage(value: unknown, gatewayProtocolVersion: ShotGoGatewayProtocolVersion): GatewayMessageRequest {
  if (value === null || typeof value !== 'object') throw new GatewaySessionError('INVALID_MESSAGE_REQUEST', 422)
  const input = value as Record<string, unknown>
  if (!hasOnlyKeys(input, ['clientRequestId', 'message', 'generationContext'])) {
    throw new GatewaySessionError('INVALID_MESSAGE_REQUEST', 422)
  }
  const message = input.message
  if (typeof input.clientRequestId !== 'string' || input.clientRequestId.length < 8 || input.clientRequestId.length > 128) {
    throw new GatewaySessionError('CLIENT_REQUEST_ID_INVALID', 422)
  }
  if (message === null || typeof message !== 'object') throw new GatewaySessionError('MESSAGE_INVALID', 422)
  const candidate = message as Record<string, unknown>
  if (!hasOnlyKeys(candidate, ['type', 'text'])
    || candidate.type !== 'text'
    || typeof candidate.text !== 'string'
    || candidate.text.trim() === ''
    || candidate.text.length > 20_000
  ) {
    throw new GatewaySessionError('MESSAGE_INVALID', 422)
  }
  const generationContext = parseGenerationContext(input.generationContext, gatewayProtocolVersion)
  return {
    clientRequestId: input.clientRequestId,
    message: { type: 'text', text: candidate.text },
    ...(generationContext === undefined ? {} : { generationContext }),
  }
}

const IMAGE_PARAMETER_KEYS = ['qualityId', 'resolutionId', 'aspectRatioId', 'multipleId'] as const
const VIDEO_PARAMETER_KEYS = ['resolutionId', 'aspectRatioId', 'duration', 'fps', 'audio', 'operationType'] as const

function parseGenerationContext(
  value: unknown,
  gatewayProtocolVersion: ShotGoGatewayProtocolVersion,
): GatewayMessageRequest['generationContext'] {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
  }
  const context = value as Record<string, unknown>
  if (!hasOnlyKeys(context, ['schemaVersion', 'kind', 'modelId', 'parameters'])
    || context.schemaVersion !== 1
    || (context.kind !== 'image' && context.kind !== 'video')
    || typeof context.modelId !== 'string'
    || context.modelId.length === 0
    || context.modelId.length > 128
    || context.parameters === null
    || typeof context.parameters !== 'object'
    || Array.isArray(context.parameters)
  ) throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
  const parameters = context.parameters as Record<string, unknown>
  const allowed = context.kind === 'image' && gatewayProtocolVersion === SHOTGO_GATEWAY_PROTOCOL_VERSION
    ? [...IMAGE_PARAMETER_KEYS, 'referenceAssets']
    : context.kind === 'image' ? IMAGE_PARAMETER_KEYS : VIDEO_PARAMETER_KEYS
  if (!hasOnlyKeys(parameters, allowed)) throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
  for (const [key, item] of Object.entries(parameters)) {
    if (key === 'referenceAssets') {
      parameters[key] = parseReferenceAssets(item)
    } else if (key === 'duration' || key === 'fps') {
      if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0 || item > 10_000) {
        throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
      }
    } else if (key === 'audio') {
      if (typeof item !== 'boolean') throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
    } else if (typeof item !== 'string' || item.length === 0 || item.length > 128) {
      throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
    }
  }
  return {
    schemaVersion: 1,
    kind: context.kind,
    modelId: context.modelId,
    parameters,
  }
}

function parseReferenceAssets(value: unknown): Array<{ mediaLibraryItemId: number }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 9) {
    throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
  }
  const seen = new Set<number>()
  return value.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
    }
    const reference = item as Record<string, unknown>
    if (!hasOnlyKeys(reference, ['mediaLibraryItemId'])
      || !Number.isSafeInteger(reference.mediaLibraryItemId)
      || Number(reference.mediaLibraryItemId) <= 0
    ) {
      throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
    }
    const mediaLibraryItemId = Number(reference.mediaLibraryItemId)
    if (seen.has(mediaLibraryItemId)) throw new GatewaySessionError('GENERATION_CONTEXT_INVALID', 422)
    seen.add(mediaLibraryItemId)
    return { mediaLibraryItemId }
  })
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function sessionPath(pathname: string): { sessionId: string; kind: 'messages' | 'events' } | undefined {
  const match = /^\/api\/agent\/v1\/sessions\/([^/]+)\/(messages|events)$/.exec(pathname)
  if (match === null) return undefined
  try {
    return { sessionId: decodeURIComponent(match[1] as string), kind: match[2] as 'messages' | 'events' }
  } catch {
    throw new GatewaySessionError('SESSION_ID_INVALID', 400)
  }
}

function cancelPath(pathname: string): { sessionId: string; runId: string } | undefined {
  const match = /^\/api\/agent\/v1\/sessions\/([^/]+)\/runs\/([^/]+)$/.exec(pathname)
  if (match === null) return undefined
  try {
    return { sessionId: decodeURIComponent(match[1] as string), runId: decodeURIComponent(match[2] as string) }
  } catch {
    throw new GatewaySessionError('SESSION_OR_RUN_ID_INVALID', 400)
  }
}

function approvalPath(pathname: string): { sessionId: string; approvalId: string } | undefined {
  const match = /^\/api\/agent\/v1\/sessions\/([^/]+)\/approvals\/([^/]+)$/.exec(pathname)
  if (match === null) return undefined
  try {
    return { sessionId: decodeURIComponent(match[1] as string), approvalId: decodeURIComponent(match[2] as string) }
  } catch {
    throw new GatewaySessionError('SESSION_OR_APPROVAL_ID_INVALID', 400)
  }
}

function parseApprovalResponse(value: unknown): GatewayApprovalResponse {
  if (value === null || typeof value !== 'object') throw new GatewaySessionError('INVALID_APPROVAL_RESPONSE', 422)
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 1 || (input.outcome !== 'allowed-once' && input.outcome !== 'rejected')) {
    throw new GatewaySessionError('INVALID_APPROVAL_RESPONSE', 422)
  }
  return { outcome: input.outcome }
}

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sessions: GatewaySessionService,
): Promise<boolean> {
  const gatewayProtocolVersion = requestedGatewayProtocol(request)
  const route = sessionPath(url.pathname)
  if (route?.kind === 'messages' && request.method === 'POST') {
    const capabilityGrant = bearerToken(request)
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new GatewaySessionError('CONTENT_TYPE_UNSUPPORTED', 415)
    }
    const body = parseMessage(await readJsonBody(request), gatewayProtocolVersion)
    const idempotencyKey = request.headers['idempotency-key']
    if (idempotencyKey !== body.clientRequestId) throw new GatewaySessionError('IDEMPOTENCY_KEY_MISMATCH', 422)
    const result = await sessions.submit({
      capabilityGrant,
      sessionId: route.sessionId,
      clientRequestId: body.clientRequestId,
      text: body.message.text,
      ...(body.generationContext === undefined ? {} : { generationContext: body.generationContext }),
    })
    const accepted: GatewayRunAccepted = {
      protocolVersion: gatewayProtocolVersion,
      sessionId: route.sessionId,
      runId: result.runId,
      streamUrl: `/api/agent/v1/sessions/${encodeURIComponent(route.sessionId)}/events`,
    }
    sendJson(response, 202, accepted, gatewayProtocolVersion)
    return true
  }

  if (route?.kind === 'events' && request.method === 'GET') {
    const capabilityGrant = bearerToken(request)
    const controller = new AbortController()
    const events = await sessions.events({
      capabilityGrant,
      sessionId: route.sessionId,
      afterCursor: parseCursor(request, url),
      signal: controller.signal,
    })
    response.once('close', () => {
      if (!response.writableEnded) controller.abort(new Error('SSE client disconnected'))
    })
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      [SHOTGO_GATEWAY_PROTOCOL_HEADER]: gatewayProtocolVersion,
    })
    for await (const event of events) {
      response.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify({
        ...event,
        protocolVersion: gatewayProtocolVersion,
      })}\n\n`)
    }
    response.end()
    return true
  }

  const cancel = cancelPath(url.pathname)
  if (cancel !== undefined && request.method === 'DELETE') {
    await sessions.cancel({
      capabilityGrant: bearerToken(request),
      sessionId: cancel.sessionId,
      runId: cancel.runId,
    })
    sendJson(response, 202, {
      protocolVersion: gatewayProtocolVersion,
      sessionId: cancel.sessionId,
      runId: cancel.runId,
      status: 'cancelling',
    }, gatewayProtocolVersion)
    return true
  }

  const approval = approvalPath(url.pathname)
  if (approval !== undefined && request.method === 'POST') {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new GatewaySessionError('CONTENT_TYPE_UNSUPPORTED', 415)
    }
    const body = parseApprovalResponse(await readJsonBody(request))
    await sessions.respondToApproval({
      capabilityGrant: bearerToken(request),
      sessionId: approval.sessionId,
      approvalId: approval.approvalId,
      outcome: body.outcome,
    })
    sendJson(response, 200, {
      protocolVersion: gatewayProtocolVersion,
      sessionId: approval.sessionId,
      approvalId: approval.approvalId,
      outcome: body.outcome,
    }, gatewayProtocolVersion)
    return true
  }

  return route !== undefined || cancel !== undefined || approval !== undefined
}

export function createGatewayServer(
  config: GatewayConfig,
  readiness: GatewayReadiness,
  sessions?: GatewaySessionService,
): Server {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://shotgo-agent.internal')

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/healthz') {
        sendJson(response, 200, {
          service: 'shotgo-agent',
          protocolVersion: SHOTGO_PROTOCOL_VERSION,
          deploymentId: config.deploymentId,
          status: 'ok',
        })
        return
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/readyz') {
        const ready = config.trafficEnabled && readiness.isInferenceRuntimeReady()
        sendJson(response, ready ? 200 : 503, {
          service: 'shotgo-agent',
          protocolVersion: SHOTGO_PROTOCOL_VERSION,
          deploymentId: config.deploymentId,
          status: ready ? 'ok' : 'not_ready',
        })
        return
      }

      if (url.pathname.startsWith('/api/agent/v1/sessions/')) {
        applySessionCors(request, response, config.canvasOrigin)
        if (request.method === 'OPTIONS') {
          response.writeHead(204, { 'Cache-Control': 'no-store' })
          response.end()
          return
        }
        if (!config.trafficEnabled || sessions === undefined) {
          sendJson(response, 503, { code: 'AGENT_TRAFFIC_DISABLED' })
          return
        }
        const matched = await handleSessionRequest(request, response, url, sessions)
        if (matched) {
          if (!response.headersSent) sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' })
          return
        }
      }

      sendJson(response, 404, { code: 'NOT_FOUND' })
    })().catch((error: unknown) => {
      if (response.destroyed) return
      const url = new URL(request.url ?? '/', 'http://shotgo-agent.internal')
      reportRequestFailure(request, url, error)
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined)
        return
      }
      const status = error instanceof GatewaySessionError ? error.status : 500
      const code = error instanceof GatewaySessionError ? error.code : 'INTERNAL_ERROR'
      sendJson(response, status, { code })
    })
  })
}

export function readGatewayConfig(environment: NodeJS.ProcessEnv): GatewayConfig {
  const rawHost = environment.SHOTGO_AGENT_HOST ?? '127.0.0.1'
  if (rawHost !== '127.0.0.1' && rawHost !== '::1') throw new Error('SHOTGO_AGENT_HOST_MUST_BE_LOOPBACK')

  const rawPort = environment.SHOTGO_AGENT_PORT ?? '3010'
  const port = Number(rawPort)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('SHOTGO_AGENT_PORT_INVALID')

  const deploymentId = environment.SHOTGO_DEPLOYMENT_ID?.trim() ?? ''
  if (!deploymentId) throw new Error('SHOTGO_DEPLOYMENT_ID_REQUIRED')

  const canvasOriginUrl = new URL(environment.SHOTGO_CANVAS_ORIGIN?.trim() || 'https://canvas.shotgo.cn')
  if (canvasOriginUrl.origin !== canvasOriginUrl.toString().replace(/\/$/, '')) {
    throw new Error('SHOTGO_CANVAS_ORIGIN_INVALID')
  }
  if (canvasOriginUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(canvasOriginUrl.hostname)) {
    throw new Error('SHOTGO_CANVAS_ORIGIN_REQUIRES_HTTPS')
  }

  const laravelBaseURL = environment.SHOTGO_LARAVEL_BASE_URL?.trim() ?? ''
  const laravelServiceToken = environment.SHOTGO_LARAVEL_SERVICE_TOKEN?.trim() ?? ''
  if ((laravelBaseURL === '') !== (laravelServiceToken === '')) {
    throw new Error('SHOTGO_LARAVEL_RUNTIME_CONFIG_INCOMPLETE')
  }

  return {
    host: rawHost,
    port,
    trafficEnabled: environment.SHOTGO_ENABLE_TRAFFIC === 'true',
    deploymentId,
    canvasOrigin: canvasOriginUrl.origin,
    ...laravelBaseURL === ''
      ? {}
      : { laravel: { baseURL: laravelBaseURL, serviceToken: laravelServiceToken } },
  }
}
