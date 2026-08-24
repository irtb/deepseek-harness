import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  type GatewayMessageRequest,
  type GatewayRunAccepted,
} from './contracts/gateway-v1.ts'
import { SHOTGO_PROTOCOL_VERSION } from './contracts/laravel-v1.ts'
import { GatewaySessionError } from './gateway-errors.ts'
import type { GatewaySessionService } from './gateway-transport.ts'

export interface GatewayConfig {
  host: '127.0.0.1' | '::1'
  port: number
  trafficEnabled: boolean
  deploymentId: string
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

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-ShotGo-Protocol-Version': SHOTGO_PROTOCOL_VERSION,
    [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
  })
  response.end(JSON.stringify(body))
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? ''
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (match === null) throw new GatewaySessionError('CAPABILITY_GRANT_REQUIRED', 401)
  return match[1] as string
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

function parseMessage(value: unknown): GatewayMessageRequest {
  if (value === null || typeof value !== 'object') throw new GatewaySessionError('INVALID_MESSAGE_REQUEST', 422)
  const input = value as Record<string, unknown>
  const message = input.message
  if (typeof input.clientRequestId !== 'string' || input.clientRequestId.length < 8 || input.clientRequestId.length > 128) {
    throw new GatewaySessionError('CLIENT_REQUEST_ID_INVALID', 422)
  }
  if (message === null || typeof message !== 'object') throw new GatewaySessionError('MESSAGE_INVALID', 422)
  const candidate = message as Record<string, unknown>
  if (candidate.type !== 'text' || typeof candidate.text !== 'string' || candidate.text.trim() === '' || candidate.text.length > 20_000) {
    throw new GatewaySessionError('MESSAGE_INVALID', 422)
  }
  return {
    clientRequestId: input.clientRequestId,
    message: { type: 'text', text: candidate.text },
  }
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

async function handleSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sessions: GatewaySessionService,
): Promise<boolean> {
  const route = sessionPath(url.pathname)
  if (route?.kind === 'messages' && request.method === 'POST') {
    const capabilityGrant = bearerToken(request)
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new GatewaySessionError('CONTENT_TYPE_UNSUPPORTED', 415)
    }
    const body = parseMessage(await readJsonBody(request))
    const idempotencyKey = request.headers['idempotency-key']
    if (idempotencyKey !== body.clientRequestId) throw new GatewaySessionError('IDEMPOTENCY_KEY_MISMATCH', 422)
    const result = await sessions.submit({
      capabilityGrant,
      sessionId: route.sessionId,
      clientRequestId: body.clientRequestId,
      text: body.message.text,
    })
    const accepted: GatewayRunAccepted = {
      protocolVersion: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      sessionId: route.sessionId,
      runId: result.runId,
      streamUrl: `/api/agent/v1/sessions/${encodeURIComponent(route.sessionId)}/events`,
    }
    sendJson(response, 202, accepted)
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
      [SHOTGO_GATEWAY_PROTOCOL_HEADER]: SHOTGO_GATEWAY_PROTOCOL_VERSION,
    })
    for await (const event of events) {
      response.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
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
      protocolVersion: SHOTGO_GATEWAY_PROTOCOL_VERSION,
      sessionId: cancel.sessionId,
      runId: cancel.runId,
      status: 'cancelling',
    })
    return true
  }

  return route !== undefined || cancel !== undefined
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
    ...laravelBaseURL === ''
      ? {}
      : { laravel: { baseURL: laravelBaseURL, serviceToken: laravelServiceToken } },
  }
}
