import { boot } from '@deepseek-ai/dsh-app-boot'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepStrictEqual } from 'node:assert/strict'
import { HarnessGatewaySessionService } from '../src/gateway-session.ts'
import { LaravelGenerationConfigClient } from '../src/laravel/generation-config-client.ts'
import { SHOTGO_MOCK_MODEL, SHOTGO_MOCK_PROVIDER } from '../src/llm/mock.ts'

const root = await mkdtemp(join(tmpdir(), 'shotgo-preset-probe-'))
const previousSessionRoot = process.env.SHOTGO_AGENT_SESSION_ROOT
const previousDshHome = process.env.DSH_HOME
process.env.SHOTGO_AGENT_SESSION_ROOT = join(root, 'sessions')
process.env.DSH_HOME = join(root, 'dsh')

const configPath = fileURLToPath(new URL('../config/base.cordis.yml', import.meta.url))
const ctx = await boot('shotgo-preset-probe', configPath)
const runtimeEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'shotgo-agent-host')
if (runtimeEntry === undefined) throw new Error('shotgo-agent-host probe entry is not mounted')

const modes = new Map([
  ['preset-image-session', 'image' as const],
  ['preset-video-session', 'video' as const],
])
const configRequests: Array<Record<string, unknown>> = []
const generationConfig = new LaravelGenerationConfigClient({
  baseURL: 'https://api.shotgo.cn',
  serviceToken: 'preset-probe-service-token',
  fetch: async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('preset probe expected a JSON body')
    const input = JSON.parse(init.body) as { sessionId: string; kind: 'image' | 'video' }
    configRequests.push(input)
    return new Response(JSON.stringify({
      protocolVersion: '2026-08-25.1',
      authorizationContextId: `probe:${input.sessionId}`,
      sessionId: input.sessionId,
      kind: input.kind,
      models: [{ id: `${input.kind}-probe`, label: `${input.kind} probe`, credits: 0, vip: false }],
      defaults: { modelId: `${input.kind}-probe` },
    }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, private',
        'X-ShotGo-Protocol-Version': '2026-08-25.1',
      },
    })
  },
})
const service = new HarnessGatewaySessionService(runtimeEntry.ctx, {
  authorize: async ({ sessionId }) => {
    const agentMode = modes.get(sessionId)
    if (agentMode === undefined) throw new Error('unexpected probe session')
    return {
      authorizationContextId: `probe:${sessionId}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
      sessionId,
      userId: 1,
      teamId: 1,
      spaceId: null,
      projectId: null,
      agentMode,
      provider: SHOTGO_MOCK_PROVIDER,
      model: SHOTGO_MOCK_MODEL,
      maxTokens: 2_048,
    }
  },
}, undefined, generationConfig)

try {
  for (const sessionId of modes.keys()) {
    const result = await service.submit({
      capabilityGrant: `grant:${sessionId}`,
      sessionId,
      clientRequestId: `request:${sessionId}`,
      text: '列出当前可用模型',
    })
    process.stdout.write(`${JSON.stringify({ event: 'preset-probe/accepted', sessionId, runId: result.runId })}\n`)
    for await (const _event of await service.events({
      capabilityGrant: `grant:${sessionId}`,
      sessionId,
      afterCursor: 0,
    })) {
      // Drain through the terminal event so the read request is part of this probe.
    }
  }
  deepStrictEqual(configRequests, [
    { grantToken: 'grant:preset-image-session', sessionId: 'preset-image-session', kind: 'image' },
    { grantToken: 'grant:preset-video-session', sessionId: 'preset-video-session', kind: 'image' },
  ])
} finally {
  await service.dispose()
  await ctx.fiber.dispose()
  if (previousSessionRoot === undefined) delete process.env.SHOTGO_AGENT_SESSION_ROOT
  else process.env.SHOTGO_AGENT_SESSION_ROOT = previousSessionRoot
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  await rm(root, { recursive: true, force: true })
}
