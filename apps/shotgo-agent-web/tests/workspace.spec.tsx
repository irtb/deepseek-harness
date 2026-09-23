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
import type { AgentSessionRecord, ExecutionMode } from '../src/agent-session.ts'

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
  it('auto-approves Run Start in automatic mode without opening the confirmation card', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'auto-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: {
        runId: 'run',
        assistantId: 'assistant',
        executionMode: 'automatic',
        projectId: 'project',
        spaceId: 'space',
      },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }],
    }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number) =>
      controller?.enqueue(
        new TextEncoder().encode(
          `id: ${cursor}\ndata: ${JSON.stringify({
            protocolVersion: '2026-09-03.1',
            cursor,
            streamEpoch: 'epoch',
            sessionId: 'auto-session',
            runId: 'run',
            agentMode: 'video',
            occurredAt: '2026-09-08T00:00:00.000Z',
            type: 'approval.requested',
            payload: { approvalId: 'approval-auto' },
          })}\n\n`,
        ),
      )
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) {
        return new Response(new ReadableStream({ start(value) { controller = value } }), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (url.includes('/approvals/')) return new Response('{}')
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'automatic',
          spaceId: 'space',
          projectId: 'project',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await waitFor(() => {
        expect(controller).toBeDefined()
      })
      await act(async () => {
        push(8)
      })
      await waitFor(() => {
        expect(session.activeRun?.respondedApprovalIds).toEqual(['approval-auto'])
      })
      expect(hook.result.current.pendingRunStart).toBeUndefined()
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).includes('/approvals/'))).toHaveLength(1)
    } finally {
      hook.unmount()
      controller?.close()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })
  it('does not auto-approve when switching to automatic while Run Start is pending', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'lock-mode-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: {
        runId: 'run',
        assistantId: 'assistant',
        executionMode: 'manual',
        projectId: 'project',
        spaceId: 'space',
      },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }],
    }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number) =>
      controller?.enqueue(
        new TextEncoder().encode(
          `id: ${cursor}\ndata: ${JSON.stringify({
            protocolVersion: '2026-09-03.1',
            cursor,
            streamEpoch: 'epoch',
            sessionId: session.sessionId,
            runId: 'run',
            agentMode: 'video',
            occurredAt: '2026-09-08T00:00:00.000Z',
            type: 'approval.requested',
            payload: { approvalId: 'approval-lock' },
          })}\n\n`,
        ),
      )
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) {
        return new Response(new ReadableStream({ start(value) { controller = value } }), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (url.includes('/approvals/')) return new Response('{}')
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      ({ executionMode }) =>
        useAgentSession({
          session,
          executionMode,
          spaceId: 'space',
          projectId: 'project',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider, initialProps: { executionMode: 'manual' as ExecutionMode } },
    )
    try {
      await waitFor(() => {
        expect(controller).toBeDefined()
      })
      await act(async () => {
        push(8)
      })
      await waitFor(() => {
        expect(hook.result.current.pendingRunStart?.approvalId).toBe('approval-lock')
      })
      await act(async () => {
        hook.rerender({ executionMode: 'automatic' })
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(hook.result.current.pendingRunStart?.approvalId).toBe('approval-lock')
      expect(session.activeRun?.respondedApprovalIds ?? []).toEqual([])
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).includes('/approvals/'))).toHaveLength(0)
    } finally {
      hook.unmount()
      controller?.close()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('locks execution mode and composer controls while Run Start confirmation is pending', async () => {
    cleanup()
    localStorage.clear()
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    const scope = sessionScope(7, null, 'video')
    const session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'ui-lock-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: { runId: 'run', assistantId: 'assistant', executionMode: 'manual' },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }],
    }
    writeSessions(localStorage, scope, [session])
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number) =>
      controller?.enqueue(
        new TextEncoder().encode(
          `id: ${cursor}\ndata: ${JSON.stringify({
            protocolVersion: '2026-09-03.1',
            cursor,
            streamEpoch: 'epoch',
            sessionId: session.sessionId,
            runId: 'run',
            agentMode: 'video',
            occurredAt: '2026-09-08T00:00:00.000Z',
            type: 'approval.requested',
            payload: { approvalId: 'approval-ui-lock' },
          })}\n\n`,
        ),
      )
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.includes('/api/spaces')) {
        return new Response(JSON.stringify({ code: 0, data: { list: [] } }))
      }
      if (url.includes('generation-config')) return new Response('{}', { status: 500 })
      if (url.includes('creative-sessions')) return new Response('{}', { status: 404 })
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) return new Response(new ReadableStream({ start(value) { controller = value } }))
      if (url.includes('/approvals/')) return new Response('{}')
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const view = render(
      <ThemeProvider>
        <AuthProvider>
          <AgentWorkspace mode="video" />
        </AuthProvider>
      </ThemeProvider>,
    )
    try {
      await waitFor(() => {
        expect(controller).toBeDefined()
      })
      await act(async () => {
        push(8)
      })
      expect(await screen.findByRole('button', { name: '开始执行' })).toBeInTheDocument()
      const automatic = screen.getByRole('button', { name: '自动模式' })
      const manual = screen.getByRole('button', { name: '手动模式' })
      expect(automatic).toBeDisabled()
      expect(manual).toBeDisabled()
      fireEvent.click(automatic)
      expect(screen.getByRole('button', { name: '开始执行' })).toBeInTheDocument()
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).includes('/approvals/'))).toHaveLength(0)
      expect(screen.getByText(/本轮已锁定/)).toBeInTheDocument()
      expect(screen.getByLabelText('创作要求')).toBeDisabled()
      expect(screen.getByRole('button', { name: /参考素材/ })).toBeDisabled()
      expect(screen.getByLabelText('模型')).toBeDisabled()
      expect(screen.getByLabelText('时长')).toBeDisabled()
      expect(screen.getByLabelText('生成音频')).toBeDisabled()
      expect(screen.getByRole('button', { name: '停止' })).toBeEnabled()
    } finally {
      view.unmount()
      controller?.close()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('cancels an active Run once, clears pending confirmation, and disables Stop while cancelling', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'cancel-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: {
        runId: 'run',
        assistantId: 'assistant',
        executionMode: 'manual',
        projectId: 'project',
        spaceId: 'space',
      },
      messages: [{ id: 'assistant', role: 'assistant', text: '', status: 'streaming' }],
    }
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const push = (cursor: number, type: string) =>
      controller?.enqueue(
        new TextEncoder().encode(
          `id: ${cursor}\ndata: ${JSON.stringify({
            protocolVersion: '2026-09-03.1',
            cursor,
            streamEpoch: 'epoch',
            sessionId: session.sessionId,
            runId: 'run',
            agentMode: 'video',
            occurredAt: '2026-09-08T00:00:00.000Z',
            type,
            payload: type === 'approval.requested' ? { approvalId: 'approval-cancel' } : {},
          })}\n\n`,
        ),
      )
    let deletes = 0
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) {
        return new Response(new ReadableStream({ start(value) { controller = value } }), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (url.includes('/runs/') && init?.method === 'DELETE') {
        deletes += 1
        return new Response('{}', { status: 202 })
      }
      if (url.includes('/approvals/')) return new Response('{}')
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error('UNEXPECTED_FIXTURE_REQUEST')
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          spaceId: 'space',
          projectId: 'project',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await waitFor(() => {
        expect(controller).toBeDefined()
      })
      await act(async () => {
        push(8, 'approval.requested')
      })
      await waitFor(() => {
        expect(hook.result.current.pendingRunStart?.approvalId).toBe('approval-cancel')
      })
      await act(async () => {
        await Promise.all([hook.result.current.cancel(), hook.result.current.cancel()])
      })
      expect(deletes).toBe(1)
      expect(hook.result.current.phase).toBe('cancelling')
      expect(hook.result.current.pendingRunStart).toBeUndefined()
      await act(async () => {
        push(9, 'run.cancelled')
      })
      await waitFor(() => {
        expect(hook.result.current.phase).toBe('idle')
      })
      expect(session.activeRun).toBeUndefined()
      expect(session.messages[0]?.status).toBe('cancelled')
    } finally {
      hook.unmount()
      try {
        controller?.close()
      } catch {
        // Stream may already be closed by abort on unmount.
      }
      vi.unstubAllGlobals()
      localStorage.clear()
    }
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
        if (outcome === 'connection-failed') {
          expect(hook.result.current.error).toMatch(/连接已中断|不会取消|不会因此取消|SYNTHETIC_CONNECTION/)
          expect(hook.result.current.error).not.toContain('本轮处理已完成')
          expect(session.messages[0]?.status).toBe('streaming')
        }
        await act(async () => { expect(await hook.result.current.send('do not resubmit', { schemaVersion: 1, kind: 'video', modelId: 'synthetic-model', parameters: {} })).toBe(false) })
        expect(session.activeRun?.runId).toBe('existing-run')
      }
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).endsWith('/events'))).toHaveLength(outcome === 'project-mismatch' ? 0 : outcome === 'connection-failed' ? 3 : 1)
    } finally { hook.unmount(); vi.unstubAllGlobals(); localStorage.clear() }
  })

  it('blocks offline send before admission without sounding finished', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = { ...newSession('video'), sessionId: 'offline-send-session' }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.includes('/creative-sessions/')) return new Response('{}', { status: 200 })
      if (url.endsWith('/grants')) throw new TypeError('Failed to fetch')
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await act(async () => {
        expect(
          await hook.result.current.send('断网发送', {
            schemaVersion: 1,
            kind: 'video',
            modelId: 'synthetic-model',
            parameters: {},
          }),
        ).toBe(false)
      })
      expect(hook.result.current.phase).toBe('error')
      expect(hook.result.current.connectionLost).toBe(false)
      expect(hook.result.current.error).toMatch(/尚未创建生成任务|不会扣费/)
      expect(hook.result.current.error).not.toContain('本轮处理已完成')
      expect(session.activeRun).toBeUndefined()
      const assistant = session.messages.find(message => message.role === 'assistant')
      expect(assistant?.status).toBe('failed')
      expect(assistant?.text).toMatch(/尚未创建生成任务|不会扣费/)
      expect(assistant?.text).not.toContain('本轮处理已完成')
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
    } finally {
      hook.unmount()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('blocks send immediately when navigator reports offline', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = { ...newSession('video'), sessionId: 'nav-offline-session' }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await act(async () => {
        expect(
          await hook.result.current.send('浏览器离线', {
            schemaVersion: 1,
            kind: 'video',
            modelId: 'synthetic-model',
            parameters: {},
          }),
        ).toBe(false)
      })
      expect(hook.result.current.error).toMatch(/网络已断开|不会扣费/)
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/grants'))).toBe(false)
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
      hook.unmount()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('marks an active Run hung when the browser goes offline', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'offline-hang-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: {
        runId: 'hang-run',
        assistantId: 'assistant',
        executionMode: 'manual',
        projectId: 'project',
        spaceId: 'space',
      },
      messages: [{ id: 'assistant', role: 'assistant', text: '正在思考中…', status: 'streaming' }],
    }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) {
        return new Response(new ReadableStream({ start() { /* stay open until aborted */ } }), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          spaceId: 'space',
          projectId: 'project',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await waitFor(() => {
        expect(hook.result.current.phase).toMatch(/authorizing|running/)
      })
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      await act(async () => {
        window.dispatchEvent(new Event('offline'))
      })
      await waitFor(() => {
        expect(hook.result.current.connectionLost).toBe(true)
      })
      expect(hook.result.current.error).toMatch(/网络已断开|连接已中断/)
      expect(hook.result.current.error).not.toContain('本轮处理已完成')
      expect(session.activeRun?.runId).toBe('hang-run')
      expect(session.messages[0]?.status).toBe('streaming')
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true })
      hook.unmount()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('keeps a mid-run stream loss hung and resumes without resubmitting', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = {
      ...newSession('video'),
      sessionId: 'hang-resume-session',
      streamEpoch: 'epoch',
      cursor: 7,
      activeRun: {
        runId: 'hang-run',
        assistantId: 'assistant',
        executionMode: 'manual',
        projectId: 'project',
        spaceId: 'space',
      },
      messages: [{ id: 'assistant', role: 'assistant', text: '正在思考中…', status: 'streaming' }],
    }
    let allowStream = false
    let eventFetches = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/events')) {
        eventFetches += 1
        if (!allowStream) throw new TypeError('Failed to fetch')
        const event = {
          protocolVersion: '2026-09-03.1',
          cursor: 8,
          streamEpoch: 'epoch',
          sessionId: session.sessionId,
          runId: 'hang-run',
          agentMode: 'video',
          occurredAt: '2026-09-08T00:00:00.000Z',
          type: 'run.completed',
          payload: {},
        }
        return new Response(`id: 8\ndata: ${JSON.stringify(event)}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          spaceId: 'space',
          projectId: 'project',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await waitFor(() => {
        expect(hook.result.current.phase).toBe('error')
      })
      expect(hook.result.current.connectionLost).toBe(true)
      expect(hook.result.current.error).toMatch(/连接已中断|不会取消|不会因此取消/)
      expect(hook.result.current.error).not.toContain('本轮处理已完成')
      expect(session.activeRun?.runId).toBe('hang-run')
      expect(session.messages[0]?.status).toBe('streaming')
      expect(session.messages[0]?.text).toContain('正在思考中')
      const failedEventFetches = eventFetches
      expect(failedEventFetches).toBeGreaterThanOrEqual(1)

      allowStream = true
      await act(async () => {
        hook.result.current.reconnect()
      })
      await waitFor(() => {
        expect(session.activeRun).toBeUndefined()
      })
      expect(hook.result.current.phase).toBe('idle')
      expect(hook.result.current.connectionLost).toBe(false)
      expect(hook.result.current.error).toBeUndefined()
      expect(session.messages[0]?.status).toBe('complete')
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).endsWith('/messages'))).toBe(false)
      expect(eventFetches).toBeGreaterThan(failedEventFetches)
    } finally {
      hook.unmount()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
  })

  it('hangs mid-send stream loss without finishing copy and without resubmit', async () => {
    cleanup()
    localStorage.clear()
    localStorage.setItem('shotgo-agent-access-token', 'synthetic-token')
    const user = { id: 7, name: 'fixture', email: 'fixture@example.test', credits: 100 }
    localStorage.setItem('shotgo-agent-user', JSON.stringify(user))
    let session: AgentSessionRecord = { ...newSession('video'), sessionId: 'mid-send-hang' }
    let eventAttempts = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input)
      if (url.endsWith('/api/me')) return new Response(JSON.stringify({ user }))
      if (url.includes('/creative-sessions/')) return new Response('{}', { status: 200 })
      if (url.endsWith('/grants')) {
        return new Response(
          JSON.stringify({
            grantToken: 'synthetic-grant',
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            sessionId: session.sessionId,
            agentMode: 'video',
          }),
        )
      }
      if (url.endsWith('/messages')) {
        return new Response(JSON.stringify({ runId: 'mid-run', streamEpoch: 'epoch' }), { status: 200 })
      }
      if (url.endsWith('/events')) {
        eventAttempts += 1
        throw new TypeError('Failed to fetch')
      }
      if (url.includes('exception-decisions')) return new Response(JSON.stringify({ decisions: [] }))
      throw new Error(`UNEXPECTED_FIXTURE_REQUEST ${url}`)
    })
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(
      () =>
        useAgentSession({
          session,
          executionMode: 'manual',
          onSessionChange: (next) => {
            session = next
          },
        }),
      { wrapper: AuthProvider },
    )
    try {
      await act(async () => {
        expect(
          await hook.result.current.send('思考中断网', {
            schemaVersion: 1,
            kind: 'video',
            modelId: 'synthetic-model',
            parameters: {},
          }),
        ).toBe(false)
      })
      expect(hook.result.current.phase).toBe('error')
      expect(hook.result.current.connectionLost).toBe(true)
      expect(hook.result.current.error).toMatch(/连接已中断|不会取消|不会因此取消/)
      expect(hook.result.current.error).not.toContain('本轮处理已完成')
      expect(session.activeRun?.runId).toBe('mid-run')
      const assistant = session.messages.find(message => message.role === 'assistant')
      expect(assistant?.status).toBe('streaming')
      expect(assistant?.text).not.toContain('本轮处理已完成')
      expect(eventAttempts).toBeGreaterThanOrEqual(1)
      expect(fetcher.mock.calls.filter(([input]) => requestUrl(input).endsWith('/messages'))).toHaveLength(1)
    } finally {
      hook.unmount()
      vi.unstubAllGlobals()
      localStorage.clear()
    }
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
