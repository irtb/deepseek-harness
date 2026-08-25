# Agent Note: 冻结 ShotGo Laravel Agent 协议 v1

Status: implemented

[English](2026-08-24-shotgo-laravel-protocol-v1.md) | 中文

## Problem

Agent Runtime 在替换 Phase 0A mock 前需要稳定的 Laravel 边界。若没有冻结契约，推理路由、AIGC 生成、计费确认、幂等恢复、协作画布版本以及长任务事件重放，可能在两侧形成不兼容的语义。

## Decision

在 `apps/shotgo-agent/contracts/` 中冻结 Wire 版本 `2026-08-25.1`。Laravel 是唯一业务权威。Harness 推理只调用 Laravel 批准的方舟路由，并使用仅供服务获取的运行时配置；文本、图片、视频和音频的业务生成使用 Capability 端点，二者不得混淆。

每个业务写请求携带四段关联上下文，且 `Idempotency-Key` 必须等于 `clientRequestId`。结果未知时按该键恢复。报价有版本并需要用户确认；金额使用十进制字符串。画布操作使用预期 revision，发生冲突时关闭式失败。项目事件 sequence、不透明 event ID、operation ID、Harness Session sequence 和 Gateway cursor 始终是相互独立的标识符。

浏览器到 Runtime 的交接曾使用一次性票据；Runtime 以服务身份交换得到不透明的短期 Capability Grant。[Canvas 承载的 Agent Grant 决策](2026-08-25-shotgo-canvas-hosted-agent-grants.zh.md)取代了该传输方式，同时保留 Laravel 作为唯一授权权威。

## Consequences

Laravel 与 Agent Runtime 现在可以依据同一套 OpenAPI、JSON Schema、TypeScript 不变量和契约测试分别实现。双方通过契约和集成验收前，真实生成、计费与画布写入仍保持禁用。任何不兼容协议变更都必须进行兼容性分析并发布新版本，禁止静默修改 v1。

## Alternatives considered

- Harness 直连供应商：会重复建立 Laravel 已有的路由、密钥、权限、计费和退款权威。
- 推理与 AIGC 生成共用一个端点：会掩盖生命周期、计费和流式语义的实质差异。
- 盲目重试写请求：可能重复扣费，或生成重复任务和画布操作。
- 画布最后写入者获胜：可能静默覆盖协作编辑。
