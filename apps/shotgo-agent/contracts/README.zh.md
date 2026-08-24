# Laravel Agent 协议 v1

[English](README.md) | 中文

状态：已于 2026-08-24 **冻结，可进入实现**。Wire 版本：`2026-08-24`。

本目录是 Agent Runtime 与 ShotGo Laravel 边界的权威来源。`openapi.json` 定义 HTTP 操作，`schemas/laravel-v1.schema.json` 定义共享消息，`src/contracts/laravel-v1.ts` 映射稳定的运行时类型和不变量。任何影响 wire format 的 Laravel 或 Agent Runtime 改动，必须同步更新这些文件和契约测试。

## 职责与调用路径

Harness 只通过 Laravel 内部推理流调用文本/推理模型。图片、视频、音频和业务文本生成都不是推理调用：模型可见 Tool 必须通过 Laravel Capability 端点提交这些操作。Laravel 始终负责供应商路由、密钥、权限、报价有效期、积分、任务、资产、退款和画布状态。

浏览器先从已登录的 Laravel Session 获取一次性交接票据。Agent Runtime 使用服务身份交换该票据，获得不透明的短期 Capability Grant。Runtime 将 Grant 作为 Bearer Token 转发，不把本地解码出的声明当作权限权威。

## 已冻结约定

- 基础路径：`/api/agent/v1`；内部推理：`/api/internal/agent/v1`。
- 每个响应携带 `X-ShotGo-Protocol-Version: 2026-08-24`。
- 每个写请求携带 `Idempotency-Key`，且必须等于请求体中的 `context.clientRequestId`。
- 写上下文包含 `sessionId`、`runId`、`actionId` 和 `clientRequestId`。
- 金额使用十进制字符串和 ISO 4217 币种，禁止使用 JavaScript number 表示金额。
- 错误使用 `application/problem+json`，并包含稳定的 `code` 与 `retryable`。
- 写请求结果未知时，通过 `clientRequestId` 查询恢复，禁止盲目重提。
- 画布写入携带 `expectedRevision`；冲突返回 `CANVAS_REVISION_CONFLICT`，随后必须重读并重新规划。
- 受报价约束的生成携带 `quoteId` 和 `quoteVersion`；报价过期或变化时必须重新取得用户确认。
- 事件使用不透明 `eventId`、项目内单调递增的 `sequence` 和 `operationId`。SSE 通过 `Last-Event-ID` 恢复；消费者按 `eventId` 去重，并在出现缺口时以 Laravel 状态对账。

## 生命周期

生成状态为 `draft → creating → queued → processing → completed`，并包含终态 `failed` 和 `cancelled`。只有非终态可以接受取消；取消可能与完成竞争，最终以 Laravel 返回状态为准。进度仅展示阶段和时间戳，不虚构百分比。

## 端点分组

- 交接票据交换与 Capability 目录；
- Harness 推理使用的 inference SSE stream；
- 生成报价、创建、状态、恢复查询和取消；
- 画布快照与乐观并发操作应用；
- 可重放的 Agent 事件流。

协议冻结不代表 Laravel 已经完成实现。它是双方实现必须共同满足的验收契约，在此之前不得启用真实写入或计费。
