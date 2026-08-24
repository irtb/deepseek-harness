import { readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayServer, readGatewayConfig } from '../src/gateway.ts'

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

async function startGateway(trafficEnabled: boolean): Promise<string> {
  const server = createGatewayServer({
    host: '127.0.0.1',
    port: 3010,
    trafficEnabled,
    deploymentId: 'test-sha',
  })
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
    const baseUrl = await startGateway(false)
    const health = await fetch(`${baseUrl}/healthz`)
    const readiness = await fetch(`${baseUrl}/readyz`)

    expect(health.status).toBe(200)
    expect(health.headers.get('x-shotgo-protocol-version')).toBe('2026-08-24')
    expect(await health.json()).toEqual({
      service: 'shotgo-agent',
      protocolVersion: '2026-08-24',
      deploymentId: 'test-sha',
      status: 'ok',
    })
    expect(readiness.status).toBe(503)
    expect(await readiness.json()).toMatchObject({ status: 'not_ready' })
  })

  it('opens readiness only through explicit traffic configuration', async () => {
    const baseUrl = await startGateway(true)
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
  })

  it('keeps deployment templates loopback-only and traffic-disabled', async () => {
    const deployRoot = new URL('../deploy/', import.meta.url)
    const [environment, nginxBootstrap, nginx, systemd] = await Promise.all([
      readFile(new URL('env/shotgo-agent.env.example', deployRoot), 'utf8'),
      readFile(new URL('nginx/agent.shotgo.cn.bootstrap.conf', deployRoot), 'utf8'),
      readFile(new URL('nginx/agent.shotgo.cn.conf', deployRoot), 'utf8'),
      readFile(new URL('systemd/shotgo-agent.service', deployRoot), 'utf8'),
    ])

    expect(environment).toContain('SHOTGO_AGENT_HOST=127.0.0.1')
    expect(environment).toContain('SHOTGO_ENABLE_TRAFFIC=false')
    expect(nginxBootstrap).toContain('/.well-known/acme-challenge/')
    expect(nginxBootstrap).not.toContain('ssl_certificate')
    expect(nginx).toContain('server 127.0.0.1:3010;')
    expect(nginx).toContain('server_name agent.shotgo.cn;')
    expect(systemd).toContain('User=shotgo-agent')
    expect(systemd).toContain('ProtectSystem=strict')
    expect(systemd).not.toContain('MemoryDenyWriteExecute=true')
  })
})
