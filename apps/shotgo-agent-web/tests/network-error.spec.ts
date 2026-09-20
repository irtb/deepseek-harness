import { describe, expect, it } from 'vitest'
import { gatewayStatusMessage, gatewayUnreachableMessage, isNetworkFailure } from '../src/network-error.ts'

describe('gateway network errors', () => {
  it('maps browser Failed to fetch for a cross-origin gateway', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(gatewayUnreachableMessage('http://127.0.0.1:3012', 'http://localhost:3011')).toContain('127.0.0.1:3012')
  })

  it('maps same-origin proxy failures to the local 3012 hint', () => {
    expect(gatewayUnreachableMessage('http://localhost:3011', 'http://localhost:3011')).toContain('3012')
  })

  it('maps gateway status codes', () => {
    expect(gatewayStatusMessage(503, 'AGENT_TRAFFIC_DISABLED', 'x')).toContain('流量开关')
    expect(gatewayStatusMessage(403, 'ORIGIN_NOT_ALLOWED', 'x')).toContain('SHOTGO_CANVAS_ORIGIN')
    expect(gatewayStatusMessage(503, 'CREATIVE_RUN_ADMISSION_UNAVAILABLE', 'x')).toContain('普通图/视频')
    expect(gatewayStatusMessage(409, 'SESSION_BUSY', 'x')).toContain('开新会话')
    expect(gatewayStatusMessage(502, undefined, 'x')).toContain('3012')
  })
})
