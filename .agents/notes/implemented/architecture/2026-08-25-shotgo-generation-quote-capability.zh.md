# Agent Note: ShotGo generation quote capability

Status: implemented

[English](2026-08-25-shotgo-generation-quote-capability.md) | 中文

## Problem

生成目录包含说明性的积分元数据，但对话式 Agent 在请求用户批准扣费前，需要取得 Laravel 权威且会过期的报价。直接复用目录值会绕过当前模型权限、默认参数、定价规则、团队上下文和余额。

## Decision

模型可见的 `generation_quote` Tool 是只读操作。它接收已补齐的图片或视频模型与参数；Gateway 注入活动 Session 的 opaque Capability Grant 和 Session id。Laravel 重新验证当前用户、可空团队、项目范围、Agent 模式和 `generation.quote` 能力，规范化默认值，执行节点操作解析，并调用现有 `PricingService`。

Laravel 返回整数积分、明细、当前余额、规范化参数、有效期以及带版本的加密 Quote Envelope。Envelope 绑定稳定授权上下文、用户、可空团队、Session、Agent 模式、生成类型、模型、规范化参数、积分和配置指纹，且有效期不超过 Grant。接口和 Tool 都不会扣积分、创建生成记录、写业务日志或派发任务。

报价属于读取操作，不携带变更上下文或幂等 Key。后续生成提交保持幂等，并解密和重新验证 Quote Envelope、重新计算报价；授权、参数、可用性或积分变化时必须再次取得用户确认。Agent 展示准确报价和有效期，模型文本不构成用户确认。

## Alternatives considered

**把目录积分元数据当作报价。** 放弃，因为目录值不代表完整 Laravel 定价计算，而且可能过期。

**为每次报价新建数据库记录。** 本阶段放弃，因为经过身份验证的加密 Envelope 可在不迁移 Schema 的前提下提供完整性、范围、有效期和后续复核。只有审计或额度预占明确需要时才引入持久报价账本。

**报价使用 Agent 服务 Token。** 放弃，因为活动 Capability Grant 已提供最小权限的用户和团队授权，而服务 Token 本身具有进程级范围。

## Consequences

报价响应可能大于普通 opaque 标识，因此协议为 opaque Token 设置 8192 字节上限。浏览器和 Harness 均不解析报价作为权限依据。应用 Key 轮换会使未完成报价失效，系统失败关闭并要求重新报价。确认与提交阶段只能在当前对话操作中保留 Envelope，不得把它记录为可复用权限。
