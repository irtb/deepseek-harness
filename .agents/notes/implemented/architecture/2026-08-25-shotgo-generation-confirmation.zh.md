# Agent Note: ShotGo 生成确认

Status: implemented

[English](2026-08-25-shotgo-generation-confirmation.md) | 中文

## 问题

模型生成的“用户已确认”文字不能证明经过身份验证的 Canvas 用户批准了一次已报价的生成扣费。该决策必须绑定精确的实时工具调用和授权上下文。

## 决策

ShotGo 运行时挂载 Harness `ApprovalService`。执行前门禁仅将 `generation_submit` 标记为需要审批。待决策请求记入 Session 审计日志并投影为 `approval.requested`；Canvas 使用当前 Capability Grant 调用 `POST /api/agent/v1/sessions/{sessionId}/approvals/{approvalId}` 回复。

Gateway 重新内省 `agent.session.approval.respond`，验证实时授权上下文与 Session，且仅接受 `allowed-once` 或 `rejected`。相同响应的重试幂等成功；修改已决策结果、过期、跨 Session、通道不可用或取消均安全失败。审批由同一个执行中的工具调用消费，不会作为可重用授权返回给模型。

## 影响

浏览器必须渲染待决策事件并提交用户决策。在下一阶段提供 Laravel 幂等写接口前，生成提交仍不可用；因此本阶段本身不能扣积分或创建任务。
