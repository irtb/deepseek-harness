#!/usr/bin/env node
/** Keyless smoke entry point for the ShotGo Agent Runtime assembly. */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SHOTGO_MOCK_MODEL, SHOTGO_MOCK_PROVIDER } from './llm/mock.ts'
import { fileURLToPath } from 'node:url'

const NAME = 'shotgo-agent'
const task = process.argv.slice(2).join(' ').trim()
if (task === '') throw new Error(`${NAME}: expected a prompt`)

const configPath = fileURLToPath(new URL('../config/base.cordis.yml', import.meta.url))
const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined

try {
  ctx = await boot(NAME, configPath)
  const runtimeEntry = [...ctx.loader.entries()]
    .find(entry => entry.options.id === 'shotgo-agent-host')
  if (runtimeEntry === undefined) throw new Error(`${NAME}: shotgo-agent-host entry is not mounted`)
  const agents = runtimeEntry.ctx.get('agents')
  if (agents === undefined) throw new Error(`${NAME}: agent registry is unavailable`)
  const llm = runtimeEntry.ctx.get('llm')
  if (llm === undefined) throw new Error(`${NAME}: LLM runtime is unavailable`)
  const handle = await agents.create({
    sessionId: SessionId('shotgo-phase-0a-smoke'),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: SHOTGO_MOCK_PROVIDER, model: SHOTGO_MOCK_MODEL },
  })
  try {
    await handle.agent.whenIdle()
    const eventTypes: string[] = []
    const visibleTools = new Set<string>()
    const calledTools: string[] = []
    const disposeListener = runtimeEntry.ctx.on('session/event', (session, event) => {
      if (session !== handle.agent.session) return
      eventTypes.push(event.type)
      if (event.type === 'request/header') {
        for (const tool of event.data.header.tools ?? []) visibleTools.add(tool.name)
      }
      if (event.type === 'tool/call') calledTools.push(event.data.name)
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    disposeListener()
    const sessions = runtimeEntry.ctx.get('sessions')
    if (sessions === undefined) throw new Error(`${NAME}: session store is unavailable`)
    await sessions.flush(handle.agent.session)
    const final = handle.agent.session.events.findLast(event => event.type === 'assistant/message')
    const answer = final?.type === 'assistant/message'
      ? final.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      : ''
    process.stdout.write(`${JSON.stringify({
      answer,
      availableProviders: llm.listProviders().map(provider => provider.id).sort(),
      eventTypes,
      visibleTools: [...visibleTools].sort(),
      calledTools,
    })}\n`)
  } finally {
    await handle.dispose()
  }
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
