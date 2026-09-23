import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AssistantTrace } from '../src/AssistantTrace.tsx'

const sample = `Agent 参数齐全，正在获取权威报价。
报价已生成，信息如下（非阻塞提示）：
模型：Seedance 2.0 Fast
费用：87 积分

正在提交生成任务：`

it('shows hang copy while streaming when the Gateway connection is lost', () => {
  render(
    <AssistantTrace
      status="streaming"
      text={sample}
      connectionLost
    />,
  )
  expect(screen.getByRole('group', { name: /连接中断 正在提交生成任务/ })).toBeInTheDocument()
  expect(screen.getByText(/服务端任务仍在进行/)).toBeInTheDocument()
  expect(screen.queryByText('本轮处理已完成')).toBeNull()
})

it('collapses remaining creative process steps after the run finishes', () => {
  render(<AssistantTrace status="complete" text={sample} />)
  expect(screen.getByRole('group', { name: /已完成 正在提交生成任务/ })).not.toHaveAttribute('open')
  expect(screen.queryByRole('group', { name: /进行中/ })).toBeNull()
})

it('renders a short completed reply as normal markdown', () => {
  render(<AssistantTrace status="complete" text="好的，这是你的视频。" />)
  expect(screen.queryByRole('group')).toBeNull()
  expect(screen.getByText('好的，这是你的视频。')).toBeInTheDocument()
})

it('strips quote-only theater into empty creative markdown when complete', () => {
  render(
    <AssistantTrace
      status="complete"
      text={'我先申请新报价，同时查询上一任务（711）。\n报价已确认（非阻塞提示）。'}
    />,
  )
  expect(screen.queryByRole('group')).toBeNull()
  expect(screen.queryByText(/申请新报价/)).toBeNull()
})

it('hides auto-policy confirmation narration only in automatic mode', () => {
  const text = `参数已锁定：**千问图像 3.0** ｜ 约 22 积分。

当前会话未启用自动执行策略，生成任务已准备就绪，等待你在界面中完成这一次授权确认；确认通过后即会自动开始生成。如果界面上的授权提示已弹出，点击确认即可，无需重复操作。`
  const { rerender } = render(
    <AssistantTrace executionMode="automatic" status="complete" text={text} />,
  )
  expect(screen.getByText(/参数已锁定/)).toBeInTheDocument()
  expect(screen.queryByText(/未启用自动执行策略/)).toBeNull()
  expect(screen.queryByText(/授权确认/)).toBeNull()

  rerender(<AssistantTrace executionMode="manual" status="complete" text={text} />)
  expect(screen.getByText(/未启用自动执行策略/)).toBeInTheDocument()
})
