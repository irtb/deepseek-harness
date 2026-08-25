import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { GatewayStreamEvent } from '../src/contracts/gateway-v1.ts'
import { createGatewayServer, readGatewayConfig } from '../src/gateway.ts'
import type { GatewaySessionService } from '../src/gateway-transport.ts'

const servers = new Set<ReturnType<typeof createGatewayServer>>()

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
    ),
  )
  servers.clear()
})

async function startGateway(
  trafficEnabled: boolean,
  runtimeReady: boolean,
  sessions?: GatewaySessionService,
): Promise<string> {
  const server = createGatewayServer({
    host: '127.0.0.1',
    port: 3010,
    trafficEnabled,
    deploymentId: 'test-sha',
    canvasOrigin: 'https://canvas.shotgo.cn',
  }, { isInferenceRuntimeReady: () => runtimeReady }, sessions)
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('production Gateway baseline', () => {
  it('stays live while keeping readiness closed before integration acceptance', async () => {
    const baseUrl = await startGateway(false, true)
    const health = await fetch(`${baseUrl}/healthz`)
    const readiness = await fetch(`${baseUrl}/readyz`)

    expect(health.status).toBe(200)
    expect(health.headers.get('x-shotgo-protocol-version')).toBe('2026-08-25.1')
    expect(await health.json()).toEqual({
      service: 'shotgo-agent',
      protocolVersion: '2026-08-25.1',
      deploymentId: 'test-sha',
      status: 'ok',
    })
    expect(readiness.status).toBe(503)
    expect(await readiness.json()).toMatchObject({ status: 'not_ready' })
  })

  it('opens readiness only when traffic and Laravel runtime configuration are ready', async () => {
    const unavailableUrl = await startGateway(true, false)
    const unavailable = await fetch(`${unavailableUrl}/readyz`)
    expect(unavailable.status).toBe(503)

    const baseUrl = await startGateway(true, true)
    const response = await fetch(`${baseUrl}/readyz`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'ok' })
  })

  it('rejects public binding and invalid deployment configuration', () => {
    expect(() => readGatewayConfig({ SHOTGO_DEPLOYMENT_ID: 'sha', SHOTGO_AGENT_HOST: '0.0.0.0' })).toThrow(
      'SHOTGO_AGENT_HOST_MUST_BE_LOOPBACK',
    )
    expect(() => readGatewayConfig({ SHOTGO_DEPLOYMENT_ID: 'sha', SHOTGO_AGENT_PORT: '0' })).toThrow(
      'SHOTGO_AGENT_PORT_INVALID',
    )
    expect(() => readGatewayConfig({})).toThrow('SHOTGO_DEPLOYMENT_ID_REQUIRED')
    expect(() => readGatewayConfig({
      SHOTGO_DEPLOYMENT_ID: 'sha',
      SHOTGO_LARAVEL_BASE_URL: 'https://api.shotgo.cn',
    })).toThrow('SHOTGO_LARAVEL_RUNTIME_CONFIG_INCOMPLETE')
    expect(() => readGatewayConfig({
      SHOTGO_DEPLOYMENT_ID: 'sha',
      SHOTGO_CANVAS_ORIGIN: 'https://canvas.shotgo.cn/agent',
    })).toThrow('SHOTGO_CANVAS_ORIGIN_INVALID')
  })

  it('keeps deployment templates loopback-only and traffic-disabled', async () => {
    const deployRoot = new URL('../deploy/', import.meta.url)
    const [environment, nginxBootstrap, nginx, supervisor] = await Promise.all([
      readFile(new URL('env/shotgo-agent.env.example', deployRoot), 'utf8'),
      readFile(new URL('nginx/agent.shotgo.cn.bootstrap.conf', deployRoot), 'utf8'),
      readFile(new URL('nginx/agent.shotgo.cn.conf', deployRoot), 'utf8'),
      readFile(new URL('supervisor/agent-shotgo.conf', deployRoot), 'utf8'),
    ])

    expect(environment).toContain('SHOTGO_AGENT_HOST=127.0.0.1')
    expect(environment).toContain('SHOTGO_ENABLE_TRAFFIC=false')
    expect(environment).toContain('SHOTGO_CANVAS_ORIGIN=https://canvas.shotgo.cn')
    expect(nginxBootstrap).toContain('/.well-known/acme-challenge/')
    expect(nginxBootstrap).not.toContain('ssl_certificate')
    expect(nginx).toContain('server 127.0.0.1:3010;')
    expect(nginx).toContain('server_name agent.shotgo.cn;')
    expect(environment).not.toContain('ARK_API_KEY=')
    expect(supervisor).toContain('[program:agent-shotgo]')
    expect(supervisor).toContain('directory=/data/projects/agent.shotgo.cn')
    expect(supervisor).toContain('user=www-data')
    expect(supervisor).not.toContain('ARK_API_KEY')
  })

  it('accepts one idempotent message and emits replayable SSE frames', async () => {
    const submitted: string[] = []
    const approvals: string[] = []
    const streamEvent: GatewayStreamEvent = {
      protocolVersion: '2026-08-25.1',
      cursor: 7,
      sessionId: 'session-http',
      runId: 'run-http',
      agentMode: 'image',
      occurredAt: '2026-08-24T00:00:00.000Z',
      type: 'run.completed',
      payload: {},
    }
    const sessions: GatewaySessionService = {
      async submit(input) {
        submitted.push(`${input.capabilityGrant}:${input.clientRequestId}:${input.text}`)
        return { runId: 'run-http' }
      },
      async events(input) {
        expect(input.afterCursor).toBe(6)
        return (async function* () { yield streamEvent })()
      },
      async respondToApproval(input) {
        approvals.push(`${input.capabilityGrant}:${input.sessionId}:${input.approvalId}:${input.outcome}`)
      },
      async cancel() {},
      async dispose() {},
    }
    const baseUrl = await startGateway(true, true, sessions)
    const accepted = await fetch(`${baseUrl}/api/agent/v1/sessions/session-http/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer opaque-grant',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'client-request-http',
      },
      body: JSON.stringify({
        clientRequestId: 'client-request-http',
        message: { type: 'text', text: '生成一张海报' },
      }),
    })
    expect(accepted.status).toBe(202)
    expect(accepted.headers.get('x-shotgo-gateway-protocol-version')).toBe('2026-08-25.1')
    expect(await accepted.json()).toEqual({
      protocolVersion: '2026-08-25.1',
      sessionId: 'session-http',
      runId: 'run-http',
      streamUrl: '/api/agent/v1/sessions/session-http/events',
    })
    expect(submitted).toEqual(['opaque-grant:client-request-http:生成一张海报'])

    const stream = await fetch(`${baseUrl}/api/agent/v1/sessions/session-http/events`, {
      headers: { Authorization: 'Bearer opaque-grant', 'Last-Event-ID': '6' },
    })
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    expect(await stream.text()).toBe(`id: 7\nevent: run.completed\ndata: ${JSON.stringify(streamEvent)}\n\n`)

    const approval = await fetch(`${baseUrl}/api/agent/v1/sessions/session-http/approvals/approval-1`, {
      method: 'POST',
      headers: { Authorization: 'Bearer opaque-grant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'allowed-once' }),
    })
    expect(approval.status).toBe(200)
    expect(await approval.json()).toMatchObject({
      sessionId: 'session-http',
      approvalId: 'approval-1',
      outcome: 'allowed-once',
    })
    expect(approvals).toEqual(['opaque-grant:session-http:approval-1:allowed-once'])
  })

  it('keeps Session APIs closed without traffic acceptance and validates idempotency', async () => {
    const disabled = await startGateway(false, true)
    const blocked = await fetch(`${disabled}/api/agent/v1/sessions/session/messages`, { method: 'POST' })
    expect(blocked.status).toBe(503)
    expect(await blocked.json()).toEqual({ code: 'AGENT_TRAFFIC_DISABLED' })

    const sessions: GatewaySessionService = {
      async submit() { throw new Error('must not submit') },
      async events() { return (async function* () {})() },
      async respondToApproval() {},
      async cancel() {},
      async dispose() {},
    }
    const enabled = await startGateway(true, true, sessions)
    const invalid = await fetch(`${enabled}/api/agent/v1/sessions/session/messages`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer opaque-grant',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'different-request',
      },
      body: JSON.stringify({
        clientRequestId: 'client-request-http',
        message: { type: 'text', text: 'hello' },
      }),
    })
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toEqual({ code: 'IDEMPOTENCY_KEY_MISMATCH' })
  })

  it('allows only the configured Canvas origin and answers its preflight', async () => {
    const sessions: GatewaySessionService = {
      async submit() { return { runId: 'unused' } },
      async events() { return (async function* () {})() },
      async respondToApproval() {},
      async cancel() {},
      async dispose() {},
    }
    const baseUrl = await startGateway(true, true, sessions)
    const preflight = await fetch(`${baseUrl}/api/agent/v1/sessions/session/messages`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://canvas.shotgo.cn',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://canvas.shotgo.cn')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(preflight.headers.get('access-control-expose-headers')).toContain('X-ShotGo-Gateway-Protocol-Version')

    const rejected = await fetch(`${baseUrl}/api/agent/v1/sessions/session/messages`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' },
    })
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull()
    expect(await rejected.json()).toEqual({ code: 'ORIGIN_NOT_ALLOWED' })
  })
})
