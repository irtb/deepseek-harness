/** Keyless-bootable Harness bundle owned by the ShotGo Agent Runtime. */

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
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { fileURLToPath } from 'node:url'
import * as mockLlm from './llm/mock.ts'
import * as arkLlm from './llm/ark.ts'
import * as generationConfigRead from './tools/generation-config-read.ts'
import * as generationQuote from './tools/generation-quote.ts'

export const name = 'shotgo-agent-runtime'

export function resolveSessionRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.SHOTGO_AGENT_SESSION_ROOT?.trim()
  if (configured !== undefined && configured.length > 0) return configured
  if (environment.NODE_ENV === 'production') {
    throw new Error('SHOTGO_AGENT_SESSION_ROOT is required in production')
  }
  return './.shotgo-agent-sessions'
}

/** Compose the restricted runtime; external providers remain request-time gated. */
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
    toolOrder: ['generation_config_read', 'generation_quote', '<unlisted-tools>'],
  })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (ctx.get('loader') !== undefined) {
    await ctx.plugin(AgentPresets, {
      default: 'shotgo-image-v1',
      roots: [{
        path: fileURLToPath(new URL(
          process.env.NODE_ENV === 'production' ? './config/agent-presets' : '../config/agent-presets',
          import.meta.url,
        )),
        trust: 'system',
      }],
      includeUserRoot: false,
    })
  }
  await ctx.plugin(llmRetry)
  await ctx.plugin(mockLlm)
  await ctx.plugin(arkLlm)
  await ctx.plugin(generationConfigRead)
  await ctx.plugin(generationQuote)
  await ctx.plugin(AgentLoop, {
    agents: [],
  })
  await ctx.plugin(JsonlSessionPersistence, {
    root: resolveSessionRoot(),
    compression: 'none',
  })
}
