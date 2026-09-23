import { describe, expect, it, vi } from 'vitest'
import {
  connectionInterruptedMessage,
  gatewayFetch,
  gatewayStatusMessage,
  gatewayUnreachableMessage,
  isNetworkFailure,
  sendBlockedOfflineMessage,
} from '../src/network-error.ts'

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
    expect(gatewayStatusMessage(422, 'GENERATION_CONTEXT_INVALID', 'x')).toContain('参考素材')
    expect(gatewayStatusMessage(502, undefined, 'x')).toContain('3012')
  })

  it('keeps hung-run copy explicit about no resubmit', () => {
    expect(connectionInterruptedMessage()).toContain('不会因此取消或重提')
    expect(connectionInterruptedMessage('无法连接本机 Agent 网关')).toContain('不会取消')
  })

  it('blocks offline send before a Run is accepted without sounding finished', () => {
    expect(sendBlockedOfflineMessage()).toContain('尚未创建生成任务')
    expect(sendBlockedOfflineMessage()).not.toContain('本轮处理已完成')
    expect(sendBlockedOfflineMessage('无法连接本机 Agent 网关')).toContain('不会扣费')
  })

  it('maps gateway connect timeouts to unreachable copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'))
          if (init?.signal?.aborted) abort()
          else init?.signal?.addEventListener('abort', abort, { once: true })
        }),
      ),
    )
    try {
      await expect(
        gatewayFetch('http://localhost:3011/api/agent/v1/sessions/x/messages', undefined, { timeoutMs: 30 }),
      ).rejects.toThrow(/3012|无法连接/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps offline send and hang copy distinct', () => {
    expect(sendBlockedOfflineMessage('网络已断开')).toContain('不会扣费')
    expect(sendBlockedOfflineMessage('网络已断开')).not.toContain('本轮处理已完成')
    expect(connectionInterruptedMessage('网络已断开')).toContain('不会取消')
    expect(connectionInterruptedMessage('网络已断开')).not.toContain('不会扣费')
  })
})
