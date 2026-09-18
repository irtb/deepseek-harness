import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExceptionDecisionCard } from '../src/ExceptionDecisionCard.tsx'
import { ExceptionDecisionClient } from '../src/exception-decision-client.ts'
import { ExceptionDecisionRecovery } from '../src/exception-decision-recovery.ts'
import { streamGatewayExceptionDecisions } from '../src/gateway-exception-stream.ts'
import {
  parseExceptionDecisionEvent,
  projectExceptionDecision,
  type ExceptionDecision,
} from '../src/exception-decision.ts'

function decision(status: ExceptionDecision['status'] = 'pending'): ExceptionDecision {
  return {
    protocolVersion: '2026-09-01.1', decisionId: 'decision-1', sessionId: 'session-1', runId: 'run-1',
    actionId: 'action-1', actionHash: 'hash-1', status, createdAt: '2026-09-01T00:00:00Z',
    expiresAt: '2026-09-01T01:00:00Z', resolvedAt: null, consumedAt: null, approvals: {},
    actions: [{ type: 'public_share', targetType: 'artifact', targetId: 'asset-1', targetLabel: '产品广告成片' }],
    requirements: [{ groupKey: 'publisher', actionIndex: 0, scope: 'target_project', roles: ['publisher'] }],
  }
}

describe('exception decision projection', () => {
  it('accepts the Gateway projection and rejects a cross-session payload', () => {
    const event = { cursor: 7, streamEpoch: 'epoch-1', sessionId: 'session-1', type: 'session.event', payload: { eventType: 'exception.decision', exceptionDecision: decision() } }
    expect(parseExceptionDecisionEvent(event)?.payload.exceptionDecision.decisionId).toBe('decision-1')
    expect(parseExceptionDecisionEvent({ ...event, sessionId: 'another-session' })).toBeUndefined()
  })

  it('does not reopen an approved card from stale replay', () => {
    const approved = decision('approved')
    const state = projectExceptionDecision({}, approved)
    expect(projectExceptionDecision(state, decision('pending'))).toBe(state)
    expect(projectExceptionDecision(state, { ...decision('consumed'), consumedAt: '2026-09-01T00:03:00Z' })['decision-1']?.status).toBe('consumed')
  })
})

describe('ExceptionDecisionCard', () => {
  it('submits one aggregated approval and replaces the card status', async () => {
    const approved = decision('approved')
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(approved), { status: 200 }))
    const client = new ExceptionDecisionClient({ apiBaseUrl: 'https://api.shotgo.cn', accessToken: () => 'token', fetch })
    const onChange = vi.fn()
    render(<ExceptionDecisionCard decision={decision()} client={client} onChange={onChange} />)

    expect(screen.getByText('公开分享')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '授权并继续' }))
    await waitFor(() =>{  expect(onChange).toHaveBeenCalledWith(approved) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/api/agent/v1/exception-decisions/decision-1/approve')
  })
})

describe('exception decision recovery', () => {
  it('recovers a known card after reload and reads authenticated SSE replay', async () => {
    const approved = decision('approved')
    const storage = new Map<string, string>([['shotgo-agent-exception-decisions:session-1', '["decision-1"]']])
    const storageAdapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    }
    const apiFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(approved), { status: 200 }))
    const client = new ExceptionDecisionClient({ apiBaseUrl: 'https://api.shotgo.cn', accessToken: () => 'user-token', fetch: apiFetch })
    const changed = vi.fn()
    const recovery = new ExceptionDecisionRecovery('session-1', client, storageAdapter, changed)
    await recovery.recover()
    expect(changed).toHaveBeenLastCalledWith({ 'decision-1': approved })

    const event = { cursor: 8, streamEpoch: 'epoch-1', sessionId: 'session-1', type: 'session.event', payload: { eventType: 'exception.decision', exceptionDecision: { ...approved, status: 'consumed' } } }
    const sse = `id: 8\nevent: session.event\ndata: ${JSON.stringify(event)}\n\n`
    const streamFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const cursors: number[] = []
    await streamGatewayExceptionDecisions({
      gatewayBaseUrl: 'https://agent.shotgo.cn', sessionId: 'session-1', capabilityGrant: 'opaque-grant',
      fetch: streamFetch, onEvent: (value) =>{  recovery.ingest(value) }, onCursor: cursor => cursors.push(cursor),
    })
    expect(cursors).toEqual([8])
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ 'decision-1': expect.objectContaining({ status: 'consumed' }) }))
    expect(streamFetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer opaque-grant' })
    expect(String(streamFetch.mock.calls[0]?.[0])).not.toContain('opaque-grant')
  })
})
