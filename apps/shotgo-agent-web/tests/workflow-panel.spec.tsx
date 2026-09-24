import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { creativeRevisionLifecycle, creativeWorkflow, parseGatewayEvent } from '../src/agent-session.ts'
import { WorkflowPanel } from '../src/WorkflowPanel.tsx'

const workflow = { version: 1 as const, creativeRunId: 'creative-run', projectRevision: 9, runStatus: 'running' as const, stages: [{ id: 'run:intake', definitionId: 'intake', title: '素材检查', status: 'completed' as const, actions: [{ id: 'run:intake:inspect', definitionId: 'inspect', title: '检查素材', status: 'completed' as const, attemptCount: 1, latestAttemptStatus: 'completed' as const }] }, { id: 'run:generate', definitionId: 'generate', title: '视频生成', status: 'running' as const, actions: [{ id: 'run:generate:submit', definitionId: 'submit', title: '生成视频', status: 'running' as const, attemptCount: 2, latestAttemptStatus: 'running' as const }] }], artifacts: [{ id: 'video-1', kind: 'video' as const, status: 'available' as const, stageId: 'run:generate', actionId: 'run:generate:submit' }] }

afterEach(cleanup)

describe('Workflow panel', () => {
  it('parses and renders non-blocking revision lifecycle metadata', () => {
    const revision = creativeRevisionLifecycle(parseGatewayEvent({ protocolVersion: '2026-08-26.2', cursor: 7, streamEpoch: 'epoch', sessionId: 'session', runId: 'run', agentMode: 'video', occurredAt: '2026-09-03T10:00:00.000Z', type: 'session.event', payload: { eventType: 'creative-project.revision-lifecycle', fixtureId: 'r0', sourceCreativeRunId: 'source', revisionCreativeRunId: 'revision', sourceEvaluationDigest: 'a'.repeat(64), revisionPlanDigest: 'b'.repeat(64), status: 'revision-running', confirmationRequired: false } })!)
    expect(revision).toBeDefined()
    render(<WorkflowPanel workflow={undefined} revision={revision!} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在自动返修')
    expect(screen.getByRole('status')).toHaveTextContent('非阻塞自动推进')
  })

  it('parses the current Gateway projection and renders workflow progress without confirmations', () => {
    const event = parseGatewayEvent({ protocolVersion: '2026-08-26.2', cursor: 3, streamEpoch: 'epoch', sessionId: 'session', runId: 'run', agentMode: 'video', occurredAt: '2026-09-03T00:00:00.000Z', type: 'session.event', payload: { eventType: 'creative-project.orchestration', workflow } })
    const parsed = creativeWorkflow(event!)
    expect(parsed).toEqual(workflow)
    render(<WorkflowPanel workflow={parsed} />)
    expect(screen.getByRole('complementary', { name: '工作流进度' })).toBeInTheDocument()
    expect(screen.getByText('素材检查')).toBeInTheDocument()
    expect(screen.getByText('生成视频')).toBeInTheDocument()
    expect(screen.getByText('执行中 · 第 2 次尝试')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '产物看板' })).toHaveTextContent('video-1')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('rejects partial workflow payloads instead of projecting guessed state', () => {
    const event = parseGatewayEvent({ protocolVersion: '2026-08-26.2', cursor: 3, streamEpoch: 'epoch', sessionId: 'session', runId: 'run', agentMode: 'video', occurredAt: '2026-09-03T00:00:00.000Z', type: 'session.event', payload: { workflow: { ...workflow, stages: [{ id: 'broken' }] } } })
    expect(creativeWorkflow(event!)).toBeUndefined()
  })
})
