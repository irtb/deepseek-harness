export interface TraceStep {
  title: string
  body: string
}

const STEP_LEAD = /^(Agent 参数|正在|报价已|新报价已|生成提交被)/

/** Internal control-plane narration that should not appear as creator-facing process steps. */
const OPS_NOISE_LEAD =
  /^(Agent 参数|正在获取|正在申请|正在读取|正在查询|报价已|新报价已|我先|同时|上一任务|已完成\s*我|读取当前|申请权威|查询上一|参数齐全)/

export function isStepLead(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed.length <= 80 && STEP_LEAD.test(trimmed)
}

export function isOpsNarrationStep(title: string): boolean {
  const trimmed = title.trim()
  if (trimmed.length === 0) return false
  if (OPS_NOISE_LEAD.test(trimmed)) return true
  return /查询.*任务|权威报价|非阻塞提示|获取权威报价|申请新报价/.test(trimmed)
}

export function splitTraceSteps(text: string): TraceStep[] {
  const steps: TraceStep[] = []
  let current: { title: string; lines: string[] } | undefined
  const flush = () => {
    if (current === undefined) return
    steps.push({ title: current.title, body: current.lines.join('\n').trim() })
    current = undefined
  }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (current === undefined) {
      if (line.trim() === '') continue
      current = { title: line.trim(), lines: [] }
      continue
    }
    if (isStepLead(line)) {
      flush()
      current = { title: line.trim(), lines: [] }
      continue
    }
    current.lines.push(line)
  }
  flush()
  return steps
}

/** Drop quote/status process theater so the UI keeps creator-facing steps only. */
export function creativeTraceSteps(steps: TraceStep[]): TraceStep[] {
  return steps.filter(step => !isOpsNarrationStep(step.title))
}

export function shouldUseTrace(text: string, status: 'complete' | 'streaming' | 'cancelled' | 'failed'): boolean {
  if (status === 'streaming') return true
  const steps = creativeTraceSteps(splitTraceSteps(text))
  const first = steps[0]
  return steps.length > 1 || (steps.length === 1 && first !== undefined && isStepLead(first.title) && !isOpsNarrationStep(first.title))
}

/** Auto mode must not ask creators to click a Run Start card that the UI never opens. */
const AUTO_CONFIRM_NARRATION =
  /未(?:启用|配置)自动执行策略|等待你在界面中完成这一次授权确认|界面上的授权提示已弹出|确认通过后即会自动开始生成/

/**
 * Drop LLM paragraphs that nudge for authorization confirmation while the session is automatic.
 * Keeps useful parameter summaries that precede those paragraphs.
 */
export function scrubAutoModeConfirmationNarration(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block.length > 0 && !AUTO_CONFIRM_NARRATION.test(block))
    .join('\n\n')
}
