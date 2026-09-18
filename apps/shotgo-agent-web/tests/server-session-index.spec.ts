import { expect, it } from 'vitest'
import type { AgentSessionRecord } from '../src/agent-session.ts'
import {
  isSensitiveUserText,
  mergeSessionIndex,
  projectCreativeTimeline,
  type CreativeSessionDetail,
} from '../src/server-session-index.ts'
import { readSessions, sessionScope, writeSessions } from '../src/session-store.ts'

it('uses the server list as sidebar authority while caching local drafts', () => {
  const local: AgentSessionRecord = {
    sessionId: 'local',
    mode: 'image',
    title: '本机草稿',
    messages: [{ id: 'm1', role: 'user', text: '未同步文案', status: 'complete' }],
    cursor: 1,
    streamEpoch: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T01:00:00Z',
  }
  const cachedRemote: AgentSessionRecord = {
    sessionId: 'remote',
    mode: 'image',
    title: '旧缓存标题',
    messages: [{ id: 'c1', role: 'user', text: '缓存文案', status: 'complete' }],
    cursor: 0,
    streamEpoch: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T02:00:00Z',
  }
  const result = mergeSessionIndex([local, cachedRemote], [
    {
      sessionId: 'remote',
      title: '核桃海报',
      revision: 3,
      coverUrl: 'https://cdn.example.test/poster.png',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T03:00:00Z',
    },
  ], 'image')
  expect(result.map(item => item.sessionId)).toEqual(['remote', 'local'])
  expect(result[0]?.title).toBe('核桃海报')
  expect(result[0]?.coverUrl).toBe('https://cdn.example.test/poster.png')
  expect(result[0]?.messages[0]?.text).toBe('缓存文案')
  expect(result.find(item => item.sessionId === 'local')?.messages[0]?.text).toBe('未同步文案')
})

it('projects user prompts and generation entries into timeline cards', () => {
  const detail: CreativeSessionDetail = {
    sessionId: '976f3bde-3333-4333-8333-dddddddddddd',
    title: '核桃仁营养海报',
    revision: 1,
    coverUrl: 'https://cdn.example.test/p706.png',
    createdAt: '2026-09-18T00:00:00Z',
    updatedAt: '2026-09-18T01:00:00Z',
    agentMode: 'image',
    spaceId: null,
    projectId: null,
    entries: [
      { id: 'e0', type: 'user_prompt', text: '核桃仁营养海报', createdAt: '2026-09-18T00:00:00Z' },
      {
        id: 'e1',
        type: 'generation',
        generationId: '706',
        clientRequestId: 'client-706',
        createdAt: '2026-09-18T00:01:00Z',
        generation: {
          generationId: '706',
          clientRequestId: 'client-706',
          state: 'completed',
          assets: [{ assetId: '1', kind: 'image', url: 'https://cdn.example.test/p706.png', sizeBytes: 10 }],
        },
      },
      {
        id: 'e2',
        type: 'generation',
        generationId: '707',
        clientRequestId: 'client-707',
        createdAt: '2026-09-18T00:02:00Z',
        generation: { generationId: '707', clientRequestId: 'client-707', state: 'completed', assets: [] },
      },
    ],
  }
  const session = projectCreativeTimeline('image', detail, detail.entries)
  expect(session.messages).toHaveLength(3)
  expect(session.messages[0]).toMatchObject({ role: 'user', text: '核桃仁营养海报' })
  expect(session.messages[1]?.generationRefs).toEqual([
    { generationId: '706', clientRequestId: 'client-706', state: 'completed' },
  ])
  expect(session.messages[1]?.artifacts?.[0]?.url).toBe('https://cdn.example.test/p706.png')
  expect(session.messages[2]?.generationRefs?.[0]?.generationId).toBe('707')
  expect(session.hydrated).toBe(true)
})

it('does not replace an in-flight local run with server timeline', () => {
  const previous: AgentSessionRecord = {
    sessionId: 'live',
    mode: 'image',
    title: '进行中',
    messages: [
      { id: 'u', role: 'user', text: '正在生成', status: 'complete' },
      { id: 'a', role: 'assistant', text: '流式中', status: 'streaming' },
    ],
    cursor: 4,
    streamEpoch: 'epoch',
    createdAt: '2026-09-18T00:00:00Z',
    updatedAt: '2026-09-18T00:01:00Z',
    activeRun: { runId: 'run-1', assistantId: 'a', executionMode: 'manual' },
  }
  const session = projectCreativeTimeline('image', {
    sessionId: 'live',
    title: '服务端标题',
    revision: 2,
    coverUrl: null,
    createdAt: previous.createdAt,
    updatedAt: '2026-09-18T00:02:00Z',
    agentMode: 'image',
    spaceId: null,
    projectId: null,
    entries: [],
  }, [])
  expect(projectCreativeTimeline('image', {
    sessionId: 'live',
    title: '服务端标题',
    revision: 2,
    coverUrl: null,
    createdAt: previous.createdAt,
    updatedAt: '2026-09-18T00:02:00Z',
    agentMode: 'image',
    spaceId: null,
    projectId: null,
    entries: [],
  }, [], previous).messages[1]?.text).toBe('流式中')
  expect(session.messages).toHaveLength(0)
})

it('treats localStorage as a disposable cache', () => {
  const scope = sessionScope(10, null, 'image')
  const storage = {
    data: new Map<string, string>(),
    getItem(key: string) {
      return this.data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      this.data.set(key, value)
    },
    removeItem(key: string) {
      this.data.delete(key)
    },
    clear() {
      this.data.clear()
    },
    key: () => null,
    length: 0,
  } as Storage
  const session: AgentSessionRecord = {
    sessionId: 'cached',
    mode: 'image',
    title: '缓存',
    messages: [{ id: 'm', role: 'user', text: '可丢', status: 'complete' }],
    cursor: 0,
    streamEpoch: null,
    createdAt: '2026-09-18T00:00:00Z',
    updatedAt: '2026-09-18T00:00:00Z',
  }
  writeSessions(storage, scope, [session])
  expect(readSessions(storage, scope)[0]?.messages[0]?.text).toBe('可丢')
  storage.clear()
  expect(readSessions(storage, scope)).toEqual([])
})

it('skips credential-like user text', () => {
  expect(isSensitiveUserText('核桃海报')).toBe(false)
  expect(isSensitiveUserText('Authorization: Bearer secret-token-value')).toBe(true)
  expect(isSensitiveUserText('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe(true)
})
