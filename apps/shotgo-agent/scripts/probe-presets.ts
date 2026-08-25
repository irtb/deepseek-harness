import { boot } from '@deepseek-ai/dsh-app-boot'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessGatewaySessionService } from '../src/gateway-session.ts'
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
})

try {
  for (const sessionId of modes.keys()) {
    const result = await service.submit({
      capabilityGrant: `grant:${sessionId}`,
      sessionId,
      clientRequestId: `request:${sessionId}`,
      text: '列出当前可用模型',
    })
    process.stdout.write(`${JSON.stringify({ event: 'preset-probe/accepted', sessionId, runId: result.runId })}\n`)
  }
} finally {
  await service.dispose()
  await ctx.fiber.dispose()
  if (previousSessionRoot === undefined) delete process.env.SHOTGO_AGENT_SESSION_ROOT
  else process.env.SHOTGO_AGENT_SESSION_ROOT = previousSessionRoot
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  await rm(root, { recursive: true, force: true })
}
