import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSessionRoot } from '../src/runtime.ts'

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = dirname(dirname(APP_ROOT))
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('ShotGo Phase 0A runtime', () => {
  it('requires an explicit writable session root in production', () => {
    expect(resolveSessionRoot({ NODE_ENV: 'development' })).toBe('./.shotgo-agent-sessions')
    expect(resolveSessionRoot({
      NODE_ENV: 'production',
      SHOTGO_AGENT_SESSION_ROOT: '/srv/shotgo/storage/sessions',
    })).toBe('/srv/shotgo/storage/sessions')
    expect(() => resolveSessionRoot({ NODE_ENV: 'production' }))
      .toThrow('SHOTGO_AGENT_SESSION_ROOT is required in production')
  })

  it('records a keyless read-only generation configuration tool round trip', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'shotgo-agent-snapshot-'))
    temporaryDirectories.push(sessionRoot)
    const result = await execa(process.execPath, [
      '--import', import.meta.resolve('tsx/esm'),
      join(APP_ROOT, 'src/bin.ts'),
      '我能使用哪些图片模型？',
    ], {
      cwd: REPO_ROOT,
      env: {
        SHOTGO_AGENT_SESSION_ROOT: sessionRoot,
        TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
      },
    })

    const output = JSON.parse(result.stdout) as {
      answer: string
      availableProviders: string[]
      eventTypes: string[]
      visibleTools: string[]
      calledTools: string[]
    }

    expect(output).toMatchInlineSnapshot(`
      {
        "answer": "当前可用图片模型：ShotGo Image Mock。此结果来自只读 generation_config_read 工具。",
        "availableProviders": [
          "shotgo-mock",
          "volcengine-ark",
        ],
        "calledTools": [
          "generation_config_read",
        ],
        "eventTypes": [
          "agent/inbox/spliced",
          "turn/start",
          "agent/inbox/spliced",
          "step/start",
          "user/message",
          "session/title",
          "request/header",
          "request/context",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/message",
          "tool/call",
          "tool/result",
          "step/end",
          "step/start",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/chunk",
          "assistant/message",
          "step/end",
          "turn/end",
        ],
        "visibleTools": [
          "generation_config_read",
          "generation_quote",
        ],
      }
    `)
    expect(output.visibleTools).not.toEqual(expect.arrayContaining([
      'bash', 'filesystem', 'terminal', 'subagent',
    ]))
  })
})
