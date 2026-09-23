import type { ExecutionMode } from './agent-session.ts'
import { AgentMarkdown } from './AgentMarkdown.tsx'
import {
  creativeTraceSteps,
  scrubAutoModeConfirmationNarration,
  shouldUseTrace,
  splitTraceSteps,
} from './assistant-trace.ts'

export function AssistantTrace({
  text,
  status,
  executionMode = 'manual',
  connectionLost = false,
}: {
  text: string
  status: 'complete' | 'streaming' | 'cancelled' | 'failed'
  executionMode?: ExecutionMode
  /** Gateway stream lost; paid Run is hung, not finished. */
  connectionLost?: boolean
}) {
  const scrubbed = executionMode === 'automatic' ? scrubAutoModeConfirmationNarration(text) : text
  const display = scrubbed || (status === 'streaming' ? (connectionLost ? '连接已中断，等待恢复…' : '正在思考…') : '')
  const steps = creativeTraceSteps(splitTraceSteps(display))
  if (!shouldUseTrace(display, status) || steps.length === 0) {
    const fallback =
      steps.length === 0 && display.trim().length > 0 && status !== 'streaming'
        ? display
          .split(/\n+/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && !/权威报价|非阻塞|查询上一|申请.*报价|报价已确认/.test(line))
          .join('\n')
        : display
    return (
      <AgentMarkdown>
        {fallback || (status === 'streaming' ? (connectionLost ? '连接已中断，等待恢复…' : '正在思考…') : '')}
      </AgentMarkdown>
    )
  }
  const streaming = status === 'streaming'
  return (
    <ol className="assistant-trace">
      {steps.map((step, index) => {
        const running = streaming && index === steps.length - 1
        const stateLabel = connectionLost && running ? '连接中断' : running ? '进行中' : '已完成'
        return (
          <li key={`${index}-${running ? 'run' : 'done'}`}>
            <details
              className={connectionLost && running ? 'lost' : running ? 'running' : 'done'}
              aria-label={`${stateLabel} ${step.title.replace(/[：:]\s*$/, '')}`}
              {...(running ? { open: true } : {})}
            >
              <summary>
                <i aria-hidden="true" />
                <span>{stateLabel}</span>
                <strong>{step.title.replace(/[：:]\s*$/, '')}</strong>
              </summary>
              {step.body.length > 0 || running ? (
                <div className="assistant-trace__body">
                  {step.body.length > 0 ? <AgentMarkdown>{step.body}</AgentMarkdown> : null}
                  {running && !connectionLost ? <b className="assistant-trace__cursor" /> : null}
                  {running && connectionLost ? (
                    <p className="assistant-trace__hang">服务端任务仍在进行；网络恢复后自动重连，不会重新提交。</p>
                  ) : null}
                </div>
              ) : null}
            </details>
          </li>
        )
      })}
    </ol>
  )
}
