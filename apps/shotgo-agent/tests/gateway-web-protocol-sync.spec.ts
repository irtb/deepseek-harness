import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS,
} from '../src/contracts/gateway-protocol.ts'
import {
  SHOTGO_GATEWAY_PROTOCOL_VERSION as webProtocolVersion,
  SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS as webSupportedVersions,
} from '../../shotgo-agent-web/src/gateway-protocol.ts'

describe('Agent Web ↔ Gateway protocol sync', () => {
  it('keeps Web and Gateway on one protocol constant set', () => {
    expect(webProtocolVersion).toBe(SHOTGO_GATEWAY_PROTOCOL_VERSION)
    expect([...webSupportedVersions]).toEqual([...SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS])
  })

  it('forbids Agent Web from hardcoding a divergent protocol literal', async () => {
    const sources = await Promise.all([
      readFile(new URL('../../shotgo-agent-web/src/gateway-client.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../shotgo-agent-web/src/gateway-exception-stream.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../shotgo-agent-web/src/agent-session.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../shotgo-agent-web/src/gateway-protocol.ts', import.meta.url), 'utf8'),
    ])
    const joined = sources.join('\n')
    expect(joined).toContain("from './gateway-protocol.ts'")
    expect(joined).toContain('../../shotgo-agent/src/contracts/gateway-protocol.ts')
    expect(joined).not.toMatch(/['"]2026-09-0[0-9]\.[0-9]+['"]/)
    expect(joined).not.toMatch(/const protocol = ['"]2026-/)
  })

  it('keeps OpenAPI enum aligned with the shared supported set', async () => {
    const document = JSON.parse(await readFile(
      new URL('../contracts/gateway-v1.openapi.json', import.meta.url),
      'utf8',
    )) as { components: { parameters: { GatewayProtocolVersion: { schema?: { enum?: string[] } } } } }
    expect(document.components.parameters.GatewayProtocolVersion.schema?.enum).toEqual([
      ...SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS,
    ])
  })
})
