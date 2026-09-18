import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamRun, submitMessage } from '../src/gateway-client.ts'

describe('Gateway client current Creative Run protocol', () => {
  beforeEach(() => vi.restoreAllMocks())

  it.each(['error', 'clean-eof'] as const)('rebinds each authenticated recovery connection after %s and ignores stale terminal cursors', async (closure) => {
    const frame = (cursor: number, streamEpoch: string, type = 'session.event') => new TextEncoder().encode(`id: ${cursor}\ndata: ${JSON.stringify({
      protocolVersion: '2026-09-03.1', cursor, streamEpoch, type, sessionId: 'session', runId: 'run',
      agentMode: 'video', occurredAt: '2026-09-08T00:00:00.000Z', payload: {},
    })}\n\n`)
    let first: ReadableStreamDefaultController<Uint8Array> | undefined
    let calls = 0
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        if (calls === 1) {
          first = controller
          controller.enqueue(frame(7, 'epoch-a', 'run.completed'))
          controller.enqueue(frame(8, 'epoch-a'))
        } else {
          controller.enqueue(frame(8, 'epoch-a', 'run.completed'))
          controller.enqueue(frame(9, 'epoch-b'))
          controller.enqueue(frame(10, 'epoch-a', 'run.completed'))
          controller.enqueue(frame(10, 'epoch-b', 'run.completed'))
          controller.close()
        }
      } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const getGrant = vi.fn(async (_force: boolean) => ({ grantToken: 'synthetic-grant', expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    const epochs: string[] = []
    const cursors: number[] = []
    await streamRun({ getGrant, sessionId: 'session', runId: 'run', streamEpoch: 'old', afterCursor: 7,
      signal: new AbortController().signal, onEpoch: epoch => epochs.push(epoch), onCursor: cursor => cursors.push(cursor),
      onEvent: (event) => { if (event.cursor === 8) {
        if (closure === 'error') first?.error(new Error('synthetic disconnect'))
        else first?.close()
      } },
    })
    expect(epochs).toEqual(['epoch-a', 'epoch-b'])
    expect(cursors).toEqual([8, 9, 10])
    expect(getGrant.mock.calls.map(([force]) => force)).toEqual([false, true])
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Last-Event-ID'))).toEqual(['7', '8'])
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true)
  })

  it('bounds repeated clean EOF retries and reports recovery failure without resubmitting', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.close() } })))
    vi.stubGlobal('fetch', fetchMock)
    const getGrant = vi.fn(async (_force: boolean) => ({ grantToken: 'synthetic-grant', expiresAt: new Date(Date.now() + 300_000).toISOString() }))
    const onEvent = vi.fn()
    const onCursor = vi.fn()
    await expect(streamRun({ getGrant, sessionId: 'session', runId: 'run', streamEpoch: 'old', afterCursor: 7,
      signal: new AbortController().signal, onEvent, onCursor, onEpoch: vi.fn(),
    })).rejects.toThrow('Gateway stream closed before terminal event')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getGrant.mock.calls.map(([force]) => force)).toEqual([false, true, true])
    expect(onEvent).not.toHaveBeenCalled()
    expect(onCursor).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true)
  })

  it('advances past a prior Run terminal event before streaming the current Run', async () => {
    const frame = (cursor: number, runId: string) => new TextEncoder().encode(`id: ${cursor}\ndata: ${JSON.stringify({
      protocolVersion: '2026-09-03.1', cursor, streamEpoch: 'epoch', type: 'run.completed',
      sessionId: 'session', runId, agentMode: 'image', occurredAt: '2026-09-16T00:00:00.000Z', payload: {},
    })}\n\n`)
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(frame(4, 'old-run'))
        controller.close()
      } }), { status: 200 }))
      .mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(frame(5, 'current-run'))
        controller.close()
      } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const onEvent = vi.fn()
    const onCursor = vi.fn()
    await streamRun({
      getGrant: async () => ({ grantToken: 'synthetic-grant', expiresAt: new Date(Date.now() + 300_000).toISOString() }),
      sessionId: 'session', runId: 'current-run', streamEpoch: 'epoch', afterCursor: 0,
      signal: new AbortController().signal, onEvent, onCursor,
    })
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Last-Event-ID'))).toEqual(['0', '4'])
    expect(onCursor.mock.calls.map(([cursor]) => cursor)).toEqual([4, 5])
    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ runId: 'current-run', cursor: 5 })
  })

  it('sends the current protocol and exact Creative Run envelope', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ runId: 'run', streamEpoch: 'epoch' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await submitMessage({ grant: 'grant', sessionId: 'session', mode: 'automatic', text: '脚本', generationContext: { schemaVersion: 1, kind: 'video', modelId: 'seedance', parameters: { aspectRatioId: '16:9', resolutionId: '720P', duration: 5, audio: true } }, creativeRun: { schemaVersion: 1, creativeRunId: 'creative-run', objective: '脚本', deliveryTargets: ['16:9 视频'], sourceRef: 'agent-web:message', businessInput: { script: '脚本', assets: [41] } } })
    const init = fetchMock.mock.calls[0]![1]!
    expect(new Headers(init.headers).get('X-ShotGo-Gateway-Protocol-Version')).toBe('2026-09-03.1')
    expect(JSON.parse(String(init.body))).toMatchObject({ executionMode: 'automatic', creativeRun: { creativeRunId: 'creative-run', businessInput: { assets: [41] } } })
  })
})
