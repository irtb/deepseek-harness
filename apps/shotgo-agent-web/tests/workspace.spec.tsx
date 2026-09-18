import { render, renderHook, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import { AgentWorkspace } from '../src/AgentWorkspace.tsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { AuthProvider } from '../src/auth.tsx'
import { ThemeProvider } from '../src/ThemeContext.tsx'
import { ThemeToggle } from '../src/ThemeToggle.tsx'
import { assistantDelta, parseGatewayEvent } from '../src/agent-session.ts'
import { newSession, readSessions, sessionScope, writeSessions } from '../src/session-store.ts'
import { useAgentSession } from '../src/useAgentSession.ts'
import type { AgentSessionRecord } from '../src/agent-session.ts'

const requestUrl = (input: RequestInfo | URL) => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

describe('session history', () => {
  beforeEach(() =>{  localStorage.clear() })

  it('isolates user, team and media-mode histories', () => {
    const personalImage = sessionScope(7, null, 'image')
    const teamImage = sessionScope(7, 3, 'image')
    const session = { ...newSession('image'), title: '商品主图' }
    writeSessions(localStorage, personalImage, [session])
    expect(readSessions(localStorage, personalImage)[0]?.title).toBe('商品主图')
    expect(readSessions(localStorage, teamImage)).toEqual([])
    expect(readSessions(localStorage, sessionScope(7, null, 'video'))).toEqual([])
  })

  it('parses an assistant text delta from the versioned Gateway event', () => {
    const value = {
      protocolVersion: '2026-09-01.1', cursor: 2, streamEpoch: 'epoch', sessionId: 'session', runId: 'run',
      agentMode: 'image', occurredAt: '2026-09-01T00:00:00Z', type: 'session.event',
      payload: { event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '正在编排' } } } },
    }
    const event = parseGatewayEvent(value)
    expect(event).toBeDefined()
    expect(assistantDelta(event!)).toBe('正在编排')
  })
})

describe('Agent workspace', () => {
  it('switches themes and restores the saved choice', () => {
    cleanup(); localStorage.clear()
    const view = render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: '切换到暗色主题' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('shotgo-agent-theme')).toBe('dark')
    view.unmount()
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    expect(screen.getByRole('button', { name: '切换到亮色主题' })).toBeInTheDocument()
  })

  it.each(['lost-response', 'storage-failed'] as const)('persists manual approval before POST in the real workspace for %s', async (failure) => {
    cleanup(); localStorage.clear()
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    const scope = sessionScope(7, null, 'video')
    const session: AgentSessionRecord = { ...newSession('video'), sessionId: 'manual-session', streamEpoch: 'epoch', cursor: 7,
      activeRun: { runId: 'run', assistantId: 'assistant', executionMode: 'manual' },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }] }
    writeSessions(localStorage, scope, [session])
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number) => controller?.enqueue(new TextEncoder().encode(`id: ${cursor}\ndata: ${JSON.stringify({
      protocolVersion: '2026-09-03.1', cursor, streamEpoch: 'epoch', sessionId: session.sessionId, runId: 'run', agentMode: 'video',
      occurredAt: '2026-09-08T00:00:00.000Z', type: 'approval.requested', payload: { approvalId: 'approval-1' },
    })}\n\n`))
    let posts = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) return new Response(JSON.stringify({ grantToken: 'synthetic-grant',
        expiresAt: new Date(Date.now() + 300_000).toISOString(), sessionId: session.sessionId, agentMode: 'video' }))
      if (url.endsWith('/events')) return new Response(new ReadableStream({ start(value) { controller = value } }))
      if (url.includes('/approvals/')) {
        posts += 1
        expect(readSessions(localStorage, scope)[0]?.activeRun?.respondedApprovalIds).toEqual(['approval-1'])
        throw new TypeError('synthetic lost response')
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    let view = render(<ThemeProvider><AuthProvider><AgentWorkspace mode="video" /></AuthProvider></ThemeProvider>)
    let restoreStorage: (() => void) | undefined
    try {
      await waitFor(() => { expect(controller).toBeDefined() })
      await act(async () => { push(8) })
      if (failure === 'storage-failed') {
        const original = localStorage.setItem.bind(localStorage)
        const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
          if (key === scope && value.includes('approval-1')) throw new Error('synthetic storage full')
          original(key, value)
        })
        restoreStorage = () => { storageSpy.mockRestore() }
      }
      fireEvent.click(await screen.findByRole('button', { name: '开始执行' }))
      await waitFor(() => { expect(screen.getByText(/开始确认结果未知/)).toBeInTheDocument() })
      expect(posts).toBe(failure === 'storage-failed' ? 0 : 1)
      expect(readSessions(localStorage, scope)[0]?.activeRun?.runId).toBe('run')
      expect(screen.queryByRole('button', { name: '开始执行' })).not.toBeInTheDocument()
      restoreStorage?.()
      if (failure === 'lost-response') {
        view.unmount(); controller?.close(); controller = undefined
        view = render(<ThemeProvider><AuthProvider><AgentWorkspace mode="video" /></AuthProvider></ThemeProvider>)
        await waitFor(() => { expect(controller).toBeDefined() })
        await act(async () => { push(9) })
        expect(screen.queryByRole('button', { name: '开始执行' })).not.toBeInTheDocument()
        expect(posts).toBe(1)
        expect(readSessions(localStorage, scope)[0]?.activeRun?.respondedApprovalIds).toEqual(['approval-1'])
      }
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
    } finally { restoreStorage?.(); view.unmount(); controller?.close(); vi.unstubAllGlobals(); localStorage.clear() }
  })
  it.each(['success', 'lost-response'] as const)('consumes a manual approval once after %s despite replay and scope switching', async (response) => {
    cleanup(); localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = { ...newSession('video'), sessionId: 'manual-session', streamEpoch: 'epoch', cursor: 7,
      activeRun: { runId: 'run', assistantId: 'assistant', executionMode: 'manual', projectId: 'project', spaceId: 'space' },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }] }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number, type: string, epoch = 'epoch') => controller?.enqueue(new TextEncoder().encode(`id: ${cursor}\ndata: ${JSON.stringify({
      protocolVersion: '2026-09-03.1', cursor, streamEpoch: epoch, sessionId: 'manual-session', runId: 'run', agentMode: 'video',
      occurredAt: '2026-09-08T00:00:00.000Z', type, payload: { approvalId: 'approval-1' },
    })}\n\n`))
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) return new Response(JSON.stringify({ grantToken: 'synthetic-grant',
        expiresAt: new Date(Date.now() + 300000).toISOString(), sessionId: session.sessionId, agentMode: 'video' }))
      if (url.endsWith('/events')) return new Response(new ReadableStream({ start(value) { controller = value } }), { headers: { 'Content-Type': 'text/event-stream' } })
      if (url.includes('/approvals/')) {
        if (response === 'lost-response') throw new TypeError('synthetic approval response lost')
        return new Response('{}')
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(({ projectId }) => useAgentSession({ session, executionMode: 'manual', spaceId: 'space', projectId,
      onSessionChange: (next) => { session = next } }), { wrapper: AuthProvider, initialProps: { projectId: 'project' } })
    try {
      await waitFor(() =>{  expect(controller).toBeDefined() })
      await act(async () => { push(8, 'approval.requested') })
      await waitFor(() =>{  expect(hook.result.current.pendingRunStart?.approvalId).toBe('approval-1') })
      await act(async () => { await Promise.all([hook.result.current.confirmRunStart('allowed-once'), hook.result.current.confirmRunStart('allowed-once')]) })
      expect(session.activeRun?.respondedApprovalIds).toEqual(['approval-1'])
      if (response === 'lost-response') {
        expect(hook.result.current.error).toContain('开始确认结果未知')
        await act(async () => { await hook.result.current.confirmRunStart('allowed-once') })
        await act(async () => {
          expect(await hook.result.current.send('do not resubmit', {
            schemaVersion: 1, kind: 'video', modelId: 'synthetic-model', parameters: {},
          })).toBe(false)
        })
        const scope = sessionScope(7, null, 'video')
        writeSessions(localStorage, scope, [session])
        expect(readSessions(localStorage, scope)[0]?.activeRun?.respondedApprovalIds).toEqual(['approval-1'])
      }
      await act(async () => { push(9, 'approval.requested'); push(8, 'approval.requested'); push(10, 'run.completed', 'foreign-epoch') })
      expect(hook.result.current.pendingRunStart).toBeUndefined()
      expect(session.activeRun?.runId).toBe('run')
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).includes('/approvals/'))).toHaveLength(1)
      await act(async () => { push(11, 'approval.resolved') })
      expect(hook.result.current.pendingRunStart).toBeUndefined()
      expect(hook.result.current.error).toBeUndefined()
      expect(session.activeRun?.respondedApprovalIds).toEqual(['approval-1'])
      hook.rerender({ projectId: 'foreign' })
      await waitFor(() =>{  expect(hook.result.current.phase).toBe('error') })
      expect(session.activeRun?.runId).toBe('run')
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
    } finally { hook.unmount(); controller?.close(); vi.unstubAllGlobals(); localStorage.clear() }
  })
  it.each(['completed', 'cold-epoch', 'cancelled', 'budget-stop', 'capability-stop', 'outcome-unknown', 'connection-failed', 'project-mismatch'] as const)('preserves a persisted Run during %s without resubmission', async (outcome) => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = { ...newSession('video'), sessionId: 'restored-session', streamEpoch: 'epoch', cursor: 7,
      activeRun: { runId: 'existing-run', assistantId: 'assistant', executionMode: 'automatic', projectId: 'project', spaceId: 'space' },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }] }
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) return new Response(JSON.stringify({ grantToken: 'synthetic-grant',
        expiresAt: new Date(Date.now() + 300000).toISOString(), sessionId: session.sessionId, agentMode: 'video' }))
      if (url.endsWith('/events')) {
        expect(new Headers(init?.headers).get('Last-Event-ID')).toBe('7')
        if (outcome === 'connection-failed') throw new Error('SYNTHETIC_CONNECTION_FAILURE')
        const event = { protocolVersion: '2026-09-03.1', cursor: 8, streamEpoch: outcome === 'cold-epoch' ? 'restarted-epoch' : 'epoch', sessionId: session.sessionId,
          runId: 'existing-run', agentMode: 'video', occurredAt: '2026-09-08T00:00:00.000Z',
          type: ['outcome-unknown', 'budget-stop', 'capability-stop'].includes(outcome) ? 'run.failed'
            : outcome === 'cancelled' ? 'run.cancelled' : 'run.completed',
          payload: { code: outcome === 'budget-stop' ? 'AUTO_POLICY_HARD_BUDGET_EXCEEDED'
            : outcome === 'capability-stop' ? 'CAPABILITY_NOT_ALLOWED' : 'GENERATION_OUTCOME_UNKNOWN' } }
        return new Response(`id: 8\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAgentSession({ session, executionMode: 'automatic', spaceId: 'space', projectId: outcome === 'project-mismatch' ? 'other' : 'project',
      onSessionChange: (next) => { session = next } }), { wrapper: AuthProvider })
    try {
      if (['completed', 'cold-epoch', 'cancelled'].includes(outcome)) {
        await waitFor(() =>{  expect(session.activeRun).toBeUndefined() })
        expect(session.cursor).toBe(8)
        expect(session.messages[0]?.status).toBe(outcome === 'cancelled' ? 'cancelled' : 'complete')
        expect(session.streamEpoch).toBe(outcome === 'cold-epoch' ? 'restarted-epoch' : 'epoch')
      } else {
        await waitFor(() =>{  expect(hook.result.current.phase).toBe('error') })
        expect(session.activeRun?.runId).toBe('existing-run')
        if (outcome === 'budget-stop') expect(hook.result.current.error).toContain('预算不足')
        if (outcome === 'capability-stop') expect(hook.result.current.error).toContain('执行权限不足')
        if (outcome === 'outcome-unknown') expect(hook.result.current.error).toContain('提交结果未知')
        await act(async () => { expect(await hook.result.current.send('do not resubmit', { schemaVersion: 1, kind: 'video', modelId: 'synthetic-model', parameters: {} })).toBe(false) })
        expect(session.activeRun?.runId).toBe('existing-run')
      }
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).endsWith('/events'))).toHaveLength(outcome === 'project-mismatch' ? 0 : outcome === 'connection-failed' ? 3 : 1)
    } finally { hook.unmount(); vi.unstubAllGlobals(); localStorage.clear() }
  })
  beforeEach(() => {
    localStorage.clear()
    history.replaceState({}, '', '/ai-tool/video-generator')
  })

  it('restores its own login and defaults to manual confirmation when automatic policy is unknown', async () => {
    const user = { id: 7, name: '运营同事', email: 'ops@example.com', credits: 100, active_team_id: null, team: null }
    localStorage.setItem('shotgo-agent-access-token', 'agent-origin-token')
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }), { status: 200 })
      if (url.includes('/api/spaces')) return new Response(JSON.stringify({ code: 0, data: { list: [{ uuid: 'space-1', name: '广告项目', firstProjectUuid: 'project-1', canvasCount: 1 }] } }), { status: 200 })
      throw new Error(`unexpected request ${url}`)
    }))

    render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByText('想制作什么视频？')).toBeInTheDocument()
    expect(screen.getByText('＋ 新建创作')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '手动模式' })).toHaveClass('active')
    expect(screen.getByText('手动模式：每轮开始前确认一次')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: '广告项目' })).toBeInTheDocument())
  })
})
