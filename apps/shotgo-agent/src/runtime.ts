/** Minimal keyless Harness bundle owned by the ShotGo Agent Runtime. */

import type { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as llmRetry from '@deepseek-ai/dsh-llm-retry'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mockLlm from './llm/mock.ts'
import * as generationConfigRead from './tools/generation-config-read.ts'

export const name = 'shotgo-agent-runtime'

/** Compose the Phase 0A runtime without coding tools or external integrations. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(Timer)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionTitleService, {
    fallbackMaxWords: 8,
    fallbackMaxBytes: 64,
    maxTitleBytes: 100,
  })
  await ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: 'You are the ShotGo Image Agent. Use only the tools mounted for this session.',
    toolOrder: ['generation_config_read', '<unlisted-tools>'],
  })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(llmRetry)
  await ctx.plugin(mockLlm)
  await ctx.plugin(generationConfigRead)
  await ctx.plugin(AgentLoop, {
    agents: [],
  })
  await ctx.plugin(JsonlSessionPersistence, {
    root: process.env.SHOTGO_AGENT_SESSION_ROOT ?? './.shotgo-agent-sessions',
    compression: 'none',
  })
}
