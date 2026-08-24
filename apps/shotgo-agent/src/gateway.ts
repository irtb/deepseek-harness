import { createServer, type Server, type ServerResponse } from 'node:http'
import { SHOTGO_PROTOCOL_VERSION } from './contracts/laravel-v1.ts'

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

function sendJson(response: ServerResponse, statusCode: number, body: GatewayStatus | { code: string }): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-ShotGo-Protocol-Version': SHOTGO_PROTOCOL_VERSION,
  })
  response.end(JSON.stringify(body))
}

export function createGatewayServer(config: GatewayConfig, readiness: GatewayReadiness): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://shotgo-agent.internal')
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' })
      return
    }

    if (url.pathname === '/healthz') {
      sendJson(response, 200, {
        service: 'shotgo-agent',
        protocolVersion: SHOTGO_PROTOCOL_VERSION,
        deploymentId: config.deploymentId,
        status: 'ok',
      })
      return
    }

    if (url.pathname === '/readyz') {
      const ready = config.trafficEnabled && readiness.isInferenceRuntimeReady()
      sendJson(response, ready ? 200 : 503, {
        service: 'shotgo-agent',
        protocolVersion: SHOTGO_PROTOCOL_VERSION,
        deploymentId: config.deploymentId,
        status: ready ? 'ok' : 'not_ready',
      })
      return
    }

    sendJson(response, 404, { code: 'NOT_FOUND' })
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
