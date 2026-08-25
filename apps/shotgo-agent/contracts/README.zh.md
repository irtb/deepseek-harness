# Laravel Agent 协议 v1

[English](README.md) | 中文

状态：Phase 0B.3 已于 2026-08-25 **冻结，可进入实现**。Wire 版本：`2026-08-25.1`。

本目录是 Agent Runtime 与 ShotGo Laravel 边界的权威来源。`openapi.json` 定义 HTTP 操作，`schemas/laravel-v1.schema.json` 定义共享消息，`src/contracts/laravel-v1.ts` 映射稳定的运行时类型和不变量。任何影响 wire format 的 Laravel 或 Agent Runtime 改动，必须同步更新这些文件和契约测试。

## 职责与调用路径

Harness 通过火山方舟直连 Laravel 批准的 `deepseek-v4-flash` 或 `deepseek-v4-pro` 推理模型。Laravel 加密保存供应商凭据，并仅向通过服务身份认证的 Agent Runtime 返回凭据和两个供应商节点 ID；Runtime 只把配置保留在进程内存中，不向浏览器、Capability Grant、Session 日志或用量报告暴露。推理前，Runtime 使用用户 Capability Grant 读取具有有效期的模型与预算策略；推理后，Runtime 使用服务身份幂等回传仅含元数据的用量。图片、视频、音频和业务文本生成不属于 Harness 推理：模型可见 Tool 必须通过 Laravel Capability 端点提交。Laravel 始终负责策略、权限、用量审计、报价有效期、积分、任务、资产、退款和画布状态。

浏览器停留在 `canvas.shotgo.cn`，使用现有 Sanctum Bearer Token 向 Laravel 申请不透明的短期 Capability Grant。Laravel 从已认证主体推导用户和可为空的团队身份，验证请求的空间、项目、Agent 模式与当前推理模型可用性，并且不接受浏览器请求体提供 `userId` 或 `teamId`。个人上下文使用 `teamId: null`，禁止构造伪团队 ID。个人账号继续使用已有的启用推理模型来源，并与团队账号使用相同的 DeepSeek 逻辑模型；团队上下文再叠加现有团队授权过滤。Agent Runtime 通过使用服务身份认证且禁止缓存的端点内省不透明 Grant，不把本地解码出的声明当作权限权威。

Laravel 为用户、可为空的团队、空间、可为空的项目、Agent 模式和 Session 绑定返回稳定的 `authorizationContextId`。Gateway 分别要求消息提交、事件读取和取消能力；刷新后的 Grant 只有在 Laravel 返回相同授权上下文时才能访问已有 Session。

## 已冻结约定

- 基础路径：`/api/agent/v1`；服务身份控制面写入：`/api/internal/agent/v1`。
- 每个响应携带 `X-ShotGo-Protocol-Version: 2026-08-25.1`。
- `GET /api/internal/agent/v1/inference-runtime-config` 必须使用服务身份认证并返回 `Cache-Control: no-store`；加密凭据或两个不同的供应商节点 ID 不完整时采用失败关闭。
- 推理策略具有短有效期并采用失败关闭；默认模型必须位于允许列表中。
- 推理用量以 `llmRequestId` 作为 `Idempotency-Key`，只允许标识符、模型、时间、状态和 Token 计数；禁止供应商密钥、提示词、消息、回答和原始响应。
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

- 使用 Sanctum 签发 Grant、使用服务身份内省 Grant，以及 Capability 目录；
- 直连推理策略读取与仅含元数据的用量审计；
- 生成报价、创建、状态、恢复查询和取消；
- 画布快照与乐观并发操作应用；
- 可重放的 Agent 事件流。

协议冻结不代表 Laravel 已经完成实现。它是双方实现必须共同满足的验收契约，在此之前不得开放 Agent readiness。删除 `/api/internal/agent/v1/inference/stream` 是相对 Wire 版本 `2026-08-24` 的有意不兼容变更。
