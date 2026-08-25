# Agent Note: 增加经过授权的 ShotGo Gateway Session 与 SSE 重放

Status: implemented

[English](2026-08-24-shotgo-gateway-session-sse.md) | 中文

## 问题

Harness Loop 已能执行无密钥对话，但浏览器还需要稳定的方式提交带标识的消息、断线后恢复且不重复显示输出，并取消活动 Turn。直接暴露 Cordis 原始事件会让浏览器依赖框架内部实现；信任调用方提供的 Session id，则会让不透明 Capability Grant 在没有权威声明校验的情况下访问 Session。

## 决策

Agent Gateway 提供独立于 Laravel 控制面协议的版本化浏览器协议。消息提交必须携带 Capability Grant，以及相互一致的 `Idempotency-Key` 与 `clientRequestId`；接口返回一个稳定 `runId`，并调度一次 Harness Follow-up。重复提交同一 Session 和请求 id 时返回原 Run，不会创建另一个 Turn；Session 活动期间的第二个请求返回 `SESSION_BUSY`。

`HarnessGatewaySessionService` 是围绕公开 Agent Registry 与 Session 服务构建的 Host Plane Adapter。其注入的 `GatewaySessionAuthorizer` 必须请求 Laravel 校验不透明 Grant 和目标 Session id，并返回权威主体、Agent 模式、Provider、Model 与输出上限。Adapter 将活动 Session 绑定到该主体，使用获批路由创建 Agent，把模型可见工作记录到 Harness Session 日志，并拒绝其他主体访问。生产入口在 Laravel 能返回完整授权结果前不挂载 Session 接入；流量与 Readiness 保持关闭，不依赖本地解码的声明，也不把推理策略 Allowlist 误当作完整授权。

Gateway 将 Harness 事件投影为可重放 SSE 帧。每个帧具有进程内单调递增的 Gateway Cursor，同时保留原始 Harness `sessionSeq`；两个计数器永不互相替代。内存保留 512 个事件，通过 `Last-Event-ID` 支持重放；请求的前缀已经不可用时返回 `SSE_CURSOR_EXPIRED`。每个 Run 最终只投影一个 `run.completed`、`run.cancelled` 或 `run.failed` 事件。取消请求中止活动 Harness Turn，但由于取消可能与完成竞争，最终状态仍以终止事件为准。

持久化的 Harness Session 日志仍是权威对话记录。内存 Cursor 投影不承诺跨重启持久化，因此生产环境要在重启后开放 Readiness，必须由恢复 Adapter 根据持久化事件重建 Gateway 投递状态。

## 验证

无密钥组合测试挂载真实 ShotGo Runtime，通过 `HarnessGatewaySessionService` 提交消息，并验证 Tool Call、Tool Result、Assistant Message、Run 终止事件、Cursor 重放、重复请求幂等和跨主体拒绝。HTTP 测试固定 `202` 响应、Gateway 版本 Header、SSE Wire 帧、`Last-Event-ID`、流量关闭响应和幂等校验失败。OpenAPI 测试固定提交、流式读取与取消的 Capability 认证，并确保浏览器协议不包含供应商凭据。

## 曾考虑的替代方案

**直接从消息 POST 返回 SSE 流。** 否决，因为浏览器原生 `EventSource` 只能通过 GET 和 `Last-Event-ID` 重连；拆分接收与投递后，消息提交可返回幂等结果，重放也拥有独立生命周期。

**把 Harness `sessionSeq` 作为 SSE Cursor。** 否决，因为 Gateway 还会发送不属于 Harness Session 记录的 Run 生命周期事件。合并两个计数器会让缺口与恢复语义不明确。

**在本地解码 Capability Grant 声明。** 否决，因为 Laravel 负责 Grant 校验与吊销、团队和项目成员关系、Agent 模式和模型策略。本地解码会形成第二套授权权威，也无法安全绑定请求的 Session。

**只用推理策略作为授权并开放生产路由。** 否决，因为该接口只能证明 Grant 具有推理能力并返回 Allowlist，无法提供足够的权威身份来绑定浏览器请求与 Session、项目或 Agent 模式。

## 后果

浏览器传输、Harness 执行、重放与取消可以在一个产品自有 Host Plane 接口后演进，无需修改上游 Package。协议增加独立的 Run 与 Cursor 标识，并引入有界重放状态。在 Laravel 实现完整的 Grant-to-Session 授权前，生产 Session 流量保持不可用；进程重启恢复也作为显式后续工作，而不是意外形成的承诺。
