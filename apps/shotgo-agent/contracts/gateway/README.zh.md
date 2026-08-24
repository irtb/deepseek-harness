# Agent Gateway 协议 v1

[English](README.md) | 中文

面向浏览器的 Gateway 协议冻结为 `2026-08-24.1`。[`gateway-v1.openapi.json`](../gateway-v1.openapi.json) 定义消息提交、运行取消和可重放的服务器发送事件（SSE），[`gateway-v1.ts`](../../src/contracts/gateway-v1.ts) 定义对应的运行时类型。该协议与 [Laravel 控制面协议](../README.zh.md) 分开版本管理，因此任一接口升级时无需改变另一接口的版本 Header。

## Session 与授权

每个 Session 请求都以 Bearer Token 携带不透明的 Capability Grant。Harness 创建或读取 Session 前，`GatewaySessionAuthorizer` 必须通过 Laravel 验证 Grant 和请求的 Session id，并返回权威主体、Agent 模式和推理路由。进程内服务将每个活动 Session 绑定到该主体；即使另一个主体知道 Session id，也会被拒绝。只有当 Authorizer 能校验所有必要声明时，生产 Gateway 才挂载 Session 路由；在此之前健康检查保持可用，Session 流量采用失败关闭。

`POST /api/agent/v1/sessions/{sessionId}/messages` 接收一条文本消息，并要求 `Idempotency-Key` 等于 `clientRequestId`。重复提交同一组 `{sessionId, clientRequestId}` 时返回原 `runId`，不会再次调度 Harness Turn。每个 Session 同时只允许一个活动 Run；并发提交返回 `SESSION_BUSY`。

## SSE 重放与取消

`GET /api/agent/v1/sessions/{sessionId}/events` 按顺序发送事件帧。SSE `id` 是 Gateway Session 内单调递增的 Cursor，不等同于 Harness `sessionSeq`、Laravel 项目事件序列、画布版本或业务幂等键。`Last-Event-ID` 从客户端最后处理的 Cursor 之后恢复。进程内重放窗口保留 512 个事件；Cursor 早于窗口时返回 `SSE_CURSOR_EXPIRED`，不会静默跳过数据。

每个 Harness Session 事件封装为 `session.event`，并保留原始 `sessionSeq`。`run.completed`、`run.cancelled` 或 `run.failed` 之一结束当前 Run 的事件流。`DELETE /api/agent/v1/sessions/{sessionId}/runs/{runId}` 只请求取消；其 `202` 响应不是最终结果，因为取消可能与完成竞争。Harness Run 的终态以 SSE 终止帧为准；Tool 已提交的业务生成仍以 Laravel 状态为准。

Session 持久化保存权威的 Harness 日志。Gateway 重放仅是进程内投递状态；生产恢复适配器必须在跨进程重启后依据持久化 Session 事件重建 Cursor 投影，才能开放 Readiness。
