import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseCreativeWorkflow, creativeWorkflow, type GatewayEvent } from '../src/agent-session.ts'
import { WorkflowPanel } from '../src/WorkflowPanel.tsx'

afterEach(cleanup)

describe('Synthetic Skill to Gateway to Web acceptance', () => {
  it.each(['automatic', 'manual'] as const)('renders %s authoritative delivery and rejects corrupt public evidence', async (mode) => {
    // JSON crosses the process boundary; the Web compiler never imports Runtime implementation files.
    const output = execFileSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e',
      `import { runClosureFixture } from './config/golden/v42-uat-volume-video/closure.fixture.ts';
       import {readGatewayCreativeWorkflow} from './src/gateway-session.ts';
       let workflow; const phases=[]; const result = await runClosureFixture(${JSON.stringify(mode)}, undefined, async observation => {
         if (observation.phase === 'delivered') workflow = observation.workflow;
         if (['quality-failed','repair-started','re-evaluating'].includes(observation.phase)) {
           const {state, source, continuitySource, continuity, results, creativeRunId, sessionId, gatewayRunId}=observation;
           const projected=observation.workflow ?? await readGatewayCreativeWorkflow({scope:state.scope, sessionId, gatewayRunId,creativeRunId,
             projects:{read:async()=>state}, evidence:{read:async()=>({publicVersion:3,source,continuitySource,continuity,results})}});
           phases.push({phase:observation.phase, workflow:projected, submitCalls:observation.submitCalls});
         }
       }, true); process.stdout.write(JSON.stringify({workflow,result,phases}));`], {
      cwd: resolve(import.meta.dirname, '../../shotgo-agent'), encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, COREPACK_ENABLE_NETWORK: '0' },
    })
    const captured = JSON.parse(output) as {
      workflow: unknown
      phases: Array<{ phase: string; workflow: unknown; submitCalls: number }>
      result: { originalStartConfirmations: number; extraConfirmations: number; paidSubmitCalls: number }
    }
    expect(captured.phases.map(row => row.phase)).toEqual(['quality-failed', 'repair-started', 're-evaluating'])
    for (const row of captured.phases) {
      const workflow = parseCreativeWorkflow(row.workflow)
      expect(workflow).toBeDefined()
      expect(workflow?.uat?.delivery.status).toBe('unavailable')
      render(<WorkflowPanel workflow={workflow} />)
      expect(screen.queryByText('合成交付证据完整')).not.toBeInTheDocument()
      if (row.phase === 'quality-failed') expect(screen.getByText('停止原因：质量未通过')).toBeInTheDocument()
      if (row.phase === 'repair-started') expect(row.submitCalls).toBe(1)
      cleanup()
    }
    const parsed = parseCreativeWorkflow(captured.workflow)
    expect(parsed?.version).toBe(3)
    expect(parsed?.uat?.mode).toBe(mode)
    expect(parseCreativeWorkflow(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
    render(<WorkflowPanel workflow={parsed} />)
    expect(screen.getByText('合成交付证据完整')).toBeInTheDocument()
    expect(screen.getByText(/实际费用：9 credits · 剩余额度：91 credits/)).toBeInTheDocument()
    expect(screen.getByText(/合成账本/)).toBeInTheDocument()
    expect(screen.getByText(/已记录耗时/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(output).not.toContain('"script"')
    type Corruptible = {
      version: number
      uat: {
        prompt?: string
        gates: Array<{ status: string }>
        cost: { actual: number | null }
        delivery: { status: string }
      }
    }
    for (const mutate of [
      (v: Corruptible) => { v.uat.prompt = 'private-input' },
      (v: Corruptible) => { v.uat.gates.pop() },
      (v: Corruptible) => { if (v.uat.gates[0]) v.uat.gates[0].status = 'failed' },
      (v: Corruptible) => { v.uat.cost.actual = 0 },
      (v: Corruptible) => { v.uat.delivery = { status: 'unavailable' } },
      (v: Corruptible) => { v.version = 99 },
    ]) {
      const invalid = structuredClone(parsed)
      // Mutation probes intentionally cross the untrusted JSON parser boundary.
      mutate(invalid as unknown as Corruptible)
      expect(parseCreativeWorkflow(invalid)).toBeUndefined()
    }
    const event: GatewayEvent = { protocolVersion: '2026-08-26.2', type: 'session.event', sessionId: 'other-session',
      runId: 'run', cursor: 1, streamEpoch: 'epoch', agentMode: 'video', occurredAt: '2026-09-08T00:00:00.000Z', payload: { workflow: parsed } }
    expect(creativeWorkflow(event)).toBeUndefined()
    const result = captured.result
    expect(result.originalStartConfirmations).toBe(mode === 'manual' ? 1 : 0)
    expect(result.extraConfirmations).toBe(0)
    expect(result.paidSubmitCalls).toBe(3)
  }, 20000)
})
