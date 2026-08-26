# Agent Gateway 协议 v1

[English](README.md) | 中文

面向浏览器的 Gateway 协议冻结为 `2026-08-26.2`。[`gateway-v1.openapi.json`](../gateway-v1.openapi.json) 定义消息提交、结构化图片或视频生成意图、一次性审批响应、运行取消和可重放的服务器发送事件（SSE），[`gateway-v1.ts`](../../src/contracts/gateway-v1.ts) 定义对应的运行时类型。该协议与当前请求版本为 `2026-08-26.1` 的 [Laravel 控制面协议](../README.zh.md) 分开管理版本。

可选的 `generationContext` 记录用户在 Canvas UI 中选择的模型和选项。协议 `2026-08-26.2` 允许图片 `parameters.referenceAssets` 携带最多九个有序且不重复的对象，每项唯一字段为正整数 `mediaLibraryItemId`；视频上下文、原始 URL、路径、名称、字节及额外字段均会被拒绝。Gateway 要求上下文类型与 Grant 绑定的 Agent 模式一致，将确定性选择与用户消息一并写入日志，并用 UI 选择替换模型提供的报价选项，同时保留 Agent 整理后的最终提示词。Laravel 解析素材归属与可信执行路径，并继续独占可用性、校验、定价、扣分和退款。模型可见的 `generation_quote` Schema 不暴露引用字段。

滚动发布顺序为 Agent、API、Canvas。Agent 向新 Canvas 返回 `2026-08-26.2`，保留明确声明 `2026-08-26.1` 的标量请求，并向未声明版本的旧客户端投影 `2026-08-25.1`；只有 `2026-08-26.2` 接受图片素材引用。未知声明版本以 `GATEWAY_PROTOCOL_UNSUPPORTED` 失败；只有相应 Canvas 构建不再被提供或缓存后，才能移除旧投影。该 Agent 向 Laravel 发送 `2026-08-26.1` 请求，但在 API 滚动期间接受 `2026-08-25.1` 响应，因此回滚时必须保持 Agent 与 API 的兼容联动。

`approval.requested` 把 Harness 已审计的待决策操作暴露给归属该 Session 的 Canvas。浏览器通过审批接口回复 `allowed-once` 或 `rejected`。Gateway 重新校验 `agent.session.approval.respond`，将响应绑定到实时授权上下文和 Session，对相同决策的重试幂等成功，并拒绝修改已决策结果或过期决策。模型文本永远不视为用户确认。

## Session 与授权

每个 Session 请求都以 Bearer Token 携带不透明的 Capability Grant。Harness 创建或读取 Session 前，`GatewaySessionAuthorizer` 通过 Laravel 验证 Grant、请求的 Session id 和操作对应能力，并返回权威授权上下文、Agent 模式和推理路由。稳定上下文绑定用户、可为空的团队、空间、可为空的项目、Agent 模式与 Session；即使同一用户知道 Session id，不同上下文也会被拒绝。只有 Authorizer 和可信 Agent Preset 均可用时，生产 Gateway 才挂载 Session 路由；在此之前健康检查保持可用，Session 流量采用失败关闭。

浏览器请求只允许来自配置的 Canvas Origin。Gateway 不使用 Cookie 响应其预检，允许 Authorization、内容、幂等和重放 Header，暴露两个协议版本 Header，并拒绝其他显式 Origin。

`POST /api/agent/v1/sessions/{sessionId}/messages` 接收一条文本消息，并要求 `Idempotency-Key` 等于 `clientRequestId`。重复提交完全相同的 `{sessionId, clientRequestId, message, generationContext}` 时返回原 `runId`，不会再次调度 Harness Turn；用同一 Key 提交变化后的内容会返回 `IDEMPOTENCY_CONFLICT`。每个 Session 同时只允许一个活动 Run；并发提交返回 `SESSION_BUSY`。

## SSE 重放与取消

`GET /api/agent/v1/sessions/{sessionId}/events` 按顺序发送事件帧。SSE `id` 是 Gateway Session 内单调递增的 Cursor，不等同于 Harness `sessionSeq`、Laravel 项目事件序列、画布版本或业务幂等键。`Last-Event-ID` 从客户端最后处理的 Cursor 之后恢复。进程内重放窗口保留 512 个事件；Cursor 早于窗口时返回 `SSE_CURSOR_EXPIRED`，不会静默跳过数据。

每个 Harness Session 事件封装为 `session.event`，并保留原始 `sessionSeq`。`run.completed`、`run.cancelled` 或 `run.failed` 之一结束当前 Run 的事件流。`DELETE /api/agent/v1/sessions/{sessionId}/runs/{runId}` 只请求取消；其 `202` 响应不是最终结果，因为取消可能与完成竞争。Harness Run 的终态以 SSE 终止帧为准；Tool 已提交的业务生成仍以 Laravel 状态为准。

Session 持久化保存权威的 Harness 日志。Gateway 重放仅是进程内投递状态；生产恢复适配器必须在跨进程重启后依据持久化 Session 事件重建 Cursor 投影，才能开放 Readiness。
