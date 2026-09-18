import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { streamRun } from '../src/gateway-client.ts'

const snapshotPath = '/Users/wayfarer/Library/Application Support/ShotGo/day6-recovery-01/runtime/ui-local/.gateway/657dd1887e75db268f887a3318cc113bf47497580d7260c603f0c7c304dd3011.snapshot.json'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('advances past a prior Run terminal from the live UI snapshot without posting', async () => {
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    sessionId: string
    streamEpoch: string
    events: Array<{ cursor: number; runId: string; type: string; sessionId: string; streamEpoch: string }>
  }
  const terminals = snap.events.filter(event => event.type === 'run.completed')
  expect(terminals.length).toBeGreaterThanOrEqual(2)
  const oldTerminal = terminals[0]!
  const currentTerminal = terminals[1]!
  const afterCursor = oldTerminal.cursor - 1
  const lastEventIds: number[] = []

  // Mirror Gateway: a retained prior-run terminal closes the stream; the next
  // connection then drains through the current Run terminal without re-POSTing.
  let connections = 0
  const server = createServer((req, res) => {
    const last = Number(req.headers['last-event-id'] ?? '0')
    lastEventIds.push(last)
    connections += 1
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
    if (connections === 1) {
      const prior = snap.events.find(event => event.cursor > last && event.type === 'run.completed'
        && event.runId === oldTerminal.runId)
      if (prior) res.write(`id: ${prior.cursor}\ndata: ${JSON.stringify(prior)}\n\n`)
      res.end()
      return
    }
    for (const event of snap.events) {
      if (event.cursor <= last) continue
      res.write(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`)
      if (event.runId === currentTerminal.runId && event.type === 'run.completed') break
    }
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address unavailable')
  const gatewayOrigin = `http://127.0.0.1:${address.port}`

  const originalFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/agent/v1/sessions/')) {
      return originalFetch(`${gatewayOrigin}/events`, init)
    }
    return originalFetch(input, init)
  })

  const onEvent: Array<{ cursor: number; runId: string; type: string }> = []
  const onCursor: number[] = []
  await streamRun({
    getGrant: async () => ({
      grantToken: 'probe-grant',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
    sessionId: snap.sessionId,
    runId: currentTerminal.runId,
    streamEpoch: snap.streamEpoch,
    afterCursor,
    signal: new AbortController().signal,
    onEvent: event => onEvent.push({ cursor: event.cursor, runId: event.runId, type: event.type }),
    onCursor: cursor => onCursor.push(cursor),
  })
  server.close()

  expect(lastEventIds[0]).toBe(afterCursor)
  expect(lastEventIds[1]).toBe(oldTerminal.cursor)
  expect(onCursor[0]).toBe(oldTerminal.cursor)
  expect(onCursor.at(-1)).toBe(currentTerminal.cursor)
  expect(onEvent.every(event => event.runId === currentTerminal.runId)).toBe(true)
  expect(onEvent.at(-1)).toEqual({
    cursor: currentTerminal.cursor,
    runId: currentTerminal.runId,
    type: 'run.completed',
  })
})
