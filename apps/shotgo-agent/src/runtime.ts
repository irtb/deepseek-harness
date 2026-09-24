/** Keyless-bootable Harness bundle owned by the ShotGo Agent Runtime. */

import type { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as llmRetry from '@deepseek-ai/dsh-llm-retry'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import * as mockLlm from './llm/mock.ts'
import * as arkLlm from './llm/ark.ts'
import * as generationConfigRead from './tools/generation-config-read.ts'
import * as generationQuote from './tools/generation-quote.ts'
import * as generationQuoteRegistry from './generation-quote-registry.ts'
import * as generationSubmit from './tools/generation-submit.ts'
import * as generationStatus from './tools/generation-status.ts'
import * as generationCancel from './tools/generation-cancel.ts'
import * as generationConfirmationGate from './generation-confirmation-gate.ts'
import * as canvasContextRead from './tools/canvas-context-read.ts'
import * as canvasPlanPreview from './tools/canvas-plan-preview.ts'
import * as canvasPlanQuoteRegistry from './canvas-plan-quote-registry.ts'
import * as canvasPlanQuote from './tools/canvas-plan-quote.ts'
import * as canvasOpsApply from './tools/canvas-ops-apply.ts'

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
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionTitleService, {
    fallbackMaxWords: 8,
    fallbackMaxBytes: 64,
    maxTitleBytes: 100,
  })
  await ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    personaPrefix: 'You are the ShotGo Image Agent. Use only the tools mounted for this session.',
    toolOrder: ['canvas_context_read', 'canvas_plan_preview', 'canvas_plan_quote', 'canvas_ops_apply', 'generation_config_read', 'generation_quote', 'generation_submit', 'generation_status', 'generation_cancel', '<unlisted-tools>'],
  })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(AgentRegistry)
  if (ctx.get('loader') !== undefined) {
    await ctx.plugin(AgentPresetRegistry, {
      default: 'shotgo-image-v1',
      modeSelectionEnabled: false,
    })
    const presetsRoot = fileURLToPath(new URL(
      process.env.NODE_ENV === 'production' ? './config/agent-presets' : '../config/agent-presets',
      import.meta.url,
    ))
    for (const presetId of ['shotgo-canvas-v1', 'shotgo-image-v1', 'shotgo-video-v1'] as const) {
      const presetDir = resolvePath(presetsRoot, presetId)
      const compositionPath = resolvePath(presetDir, 'agent.cordis.yml')
      const plugins = loadYaml(await readFile(compositionPath, 'utf8'))
      if (!Array.isArray(plugins)) throw new Error(`Invalid ShotGo preset composition: ${presetId}`)
      await ctx.plugin(AgentPreset, {
        id: presetId,
        name: presetId,
        plugins: plugins.map((entry) => {
          if (entry === null || typeof entry !== 'object') return entry
          const row = entry as Record<string, unknown>
          const name = row.name
          if (typeof name !== 'string' || !(name.startsWith('.') || name.startsWith('/'))) return entry
          return { ...row, name: pathToFileURL(resolvePath(presetDir, name)).href }
        }),
      })
    }
  }
  await ctx.plugin(llmRetry)
  await ctx.plugin(mockLlm)
  await ctx.plugin(arkLlm)
  await ctx.plugin(generationConfigRead)
  await ctx.plugin(generationQuoteRegistry)
  await ctx.plugin(generationQuote)
  await ctx.plugin(generationSubmit)
  await ctx.plugin(generationStatus)
  await ctx.plugin(generationCancel)
  await ctx.plugin(canvasPlanQuoteRegistry)
  await ctx.plugin(generationConfirmationGate)
  await ctx.plugin(canvasContextRead)
  await ctx.plugin(canvasPlanPreview)
  await ctx.plugin(canvasPlanQuote)
  await ctx.plugin(canvasOpsApply)
  await ctx.plugin(AgentLoop, {
    agents: [],
  })
  await ctx.plugin(JsonlSessionPersistence, {
    root: resolveSessionRoot(),
    compression: 'none',
  })
}
