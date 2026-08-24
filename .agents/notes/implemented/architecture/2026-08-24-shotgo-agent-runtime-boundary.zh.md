# Agent Note: ShotGo Agent Runtime 边界

Status: implemented

[English](2026-08-24-shotgo-agent-runtime-boundary.md) | 中文

## Problem

ShotGo 需要 Canvas、Image、Video 三类对话式 Agent，同时必须持续跟随 DeepSeek Harness 更新。把产品行为写进上游 package 会让升级持续产生冲突；让 Harness 直接调用模型供应商或 ShotGo 数据库，又会为模型路由、密钥、权限、计费、生成任务和画布状态制造第二套业务权威。第一阶段还需要在 Laravel wire contract 尚未确定时，用确定性链路证明 Harness Loop 可以调用 ShotGo Tool。

## Decision

ShotGo 产品代码只存在于 `apps/shotgo-agent` 下的私有 workspace App `@shotgo/agent-runtime`。它只组合 Harness 的公开服务和 Cordis 扩展点，不修改 `packages/`、`vendor/`、`native/`、`apps/web/` 或 `agent-loop`。

Runtime 明确区分 Host Plane 与 Agent Plane Preset。Host Plane 负责进程启动、Session 持久化、LLM Provider seam 和共享 ShotGo Tool；三个受信任、版本化的 Preset 负责各 Session 的 Persona、Prompt、Skill、Tool 可见性和策略。三类 Agent 共享实现，其目录是组合声明，不是三套服务或代码副本。

Harness 负责推理循环和 Session 日志。Laravel 继续同时负责推理模型供应商路由与业务 AIGC 操作。未来的 `ShotGoLlmAdapter` 调用 Laravel inference；图片、视频、文本、音频、画布、报价、计费、任务和资产 Tool 调用 Laravel Capability API。Harness 不持有供应商密钥，也不访问 ShotGo 数据库。

Phase 0A 交付无密钥、只读组合。确定性的 mock `LlmAdapter` 只调用 `generation_config_read`；Loader 启动的 snapshot 证明消息、request header、tool call、tool result、第二次推理、最终回答和 Session 持久化 flush。Phase 0B 冻结协议前，不虚构 Laravel 端点、计费规则、生成提交或画布写入。

## Alternatives considered

- **在 Harness 核心 package 中开发 ShotGo 行为**——拒绝，因为每次上游合并都会混合产品改动和框架改动，并重复实现业务权威。
- **创建三个独立 Agent 服务或仓库**——拒绝，因为 Gateway、推理路由、Laravel Client、Session 持久化、策略和大多数 Tool 都是共享能力，复制后必然漂移。
- **让 Harness 直接连接推理或 AIGC 供应商**——拒绝，因为 Laravel 已经负责密钥、模型可见性、成本、积分、Provider 路由、持久任务、退款和资产。
- **先实现临时 Laravel API**——拒绝，因为未经评审的临时 wire format 会变成意外兼容债务。先用 keyless 纵向链路证明 Harness 组合。

## Consequences

- 上游升级可把 `apps/shotgo-agent` 和 workspace lockfile 视为预期产品差异；不可避免的核心补丁必须作为例外记录在 `PATCHES.md`。
- Phase 0A executable 是 smoke 入口而不是生产 Gateway，但它的 Session transcript 固定了第一条模型可见 contract。
- Phase 0B 必须在启用外部写操作前定义 inference streaming、取消、错误与重试语义、Capability Grant、幂等标识、推理模型配置和计费。
- 生产 Preset 不得加载用户根目录、shell、filesystem、terminal、subagent、自修改或动态插件安装能力。
