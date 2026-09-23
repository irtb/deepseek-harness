import { expect, it } from 'vitest'
import {
  creativeTraceSteps,
  isOpsNarrationStep,
  scrubAutoModeConfirmationNarration,
  shouldUseTrace,
  splitTraceSteps,
} from '../src/assistant-trace.ts'

const sample = `Agent 参数齐全，正在获取权威报价。
报价已生成，信息如下（非阻塞提示）：
模型：Seedance 2.0 Fast
费用：87 积分

正在提交生成任务：

报价已过期，正在用相同参数重新获取报价：

生成提交被拒绝，以下是当前状态说明：
提交结果：未通过授权`

it('splits blank-line process blocks and uses the first line as the title', () => {
  const steps = splitTraceSteps(sample)
  expect(steps.map(step => step.title)).toEqual([
    'Agent 参数齐全，正在获取权威报价。',
    '报价已生成，信息如下（非阻塞提示）：',
    '正在提交生成任务：',
    '报价已过期，正在用相同参数重新获取报价：',
    '生成提交被拒绝，以下是当前状态说明：',
  ])
  expect(steps[1]?.body).toContain('Seedance 2.0 Fast')
  expect(steps[4]?.body).toContain('未通过授权')
})

it('drops quote and previous-task process theater from creator-facing steps', () => {
  const creative = creativeTraceSteps(splitTraceSteps(sample))
  expect(creative.map(step => step.title)).toEqual([
    '正在提交生成任务：',
    '生成提交被拒绝，以下是当前状态说明：',
  ])
  expect(isOpsNarrationStep('我先申请新报价，同时查询上一任务（711）')).toBe(true)
  expect(isOpsNarrationStep('约 16 积分')).toBe(false)
})

it('uses a process trace for streaming or multi-step creative logs', () => {
  expect(shouldUseTrace('', 'streaming')).toBe(true)
  expect(shouldUseTrace(sample, 'complete')).toBe(true)
  expect(shouldUseTrace('好的，这是你的视频。', 'complete')).toBe(false)
  expect(shouldUseTrace('Agent 参数齐全，正在获取权威报价。\n报价已生成，信息如下（非阻塞提示）：', 'complete')).toBe(false)
})

it('keeps parameter summary and drops auto-mode authorization confirmation narration', () => {
  const text = `参数已锁定：**千问图像 3.0** ｜ 标准画质 ｜ 2K ｜ 自适应比例，约 22 积分。

当前会话未启用自动执行策略，生成任务已准备就绪，等待你在界面中完成这一次授权确认；确认通过后即会自动开始生成。如果界面上的授权提示已弹出，点击确认即可，无需重复操作。`
  expect(scrubAutoModeConfirmationNarration(text)).toBe(
    '参数已锁定：**千问图像 3.0** ｜ 标准画质 ｜ 2K ｜ 自适应比例，约 22 积分。',
  )
  expect(
    scrubAutoModeConfirmationNarration(
      '当前会话未配置自动执行策略，需要你确认一次后才会开始生成。确认后我将立即为你生成。是否开始？',
    ),
  ).toBe('')
})
