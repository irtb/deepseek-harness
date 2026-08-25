# Agent Note: ShotGo generation config capability

Status: implemented

[English](2026-08-25-shotgo-generation-config-capability.md) | 中文

## Problem

Phase 0A 的 `generation_config_read` Tool 返回确定性 Fixture。Phase 1 需要保持同一模型可见 Tool，同时根据 Laravel 当前对已认证 ShotGo 主体的授权，返回可用图片或视频模型，并且不引入计费和生成副作用。

## Decision

Laravel 在 Agent 服务身份认证下提供 `POST /api/internal/agent/v1/generation/config`。每个请求同时携带浏览器签发的 opaque Grant、Session id 和请求的生成类型。Laravel 解析 Grant，重新验证当前用户、团队和可选项目范围，检查 `generation.config.read`，约束 Agent 模式对应的生成类型，并返回禁止缓存的模型目录。

Gateway 仅在活动 Harness Agent Scope 的内存中绑定当前 opaque Grant。只有常规 Session 提交内省返回相同授权上下文后，刷新后的 Grant 才替换该绑定。Scope 内的 `generation_config_read` Tool 通过窄接口 Reader 调用 Laravel，并转发取消信号。Grant 和服务 Token 均不会进入 Harness Session 事件、Tool Result、运行配置文件或业务数据库记录。

无密钥入口继续保留确定性 Fixture，作为本地 Smoke 回退；生产 `gateway-bin` 始终安装 Laravel Reader。投影给模型的响应仅包含请求类型和可见模型元数据；模型可用性的最终权威仍是 Laravel。

## Alternatives considered

**由 Harness 复用浏览器 Sanctum 接口。** 放弃，因为这会把账户级浏览器凭据转发给独立 Agent Runtime，并绕过 Session 级 Grant 边界。

**在 Grant 内省响应中返回模型目录。** 放弃，因为接入授权和业务配置的缓存、调用频率、演进节奏不同。独立读取允许 Tool 刷新 Laravel 权威模型状态，而无需重新定义 Session 身份。

**把 Grant 持久化到 Harness Session。** 放弃，因为 Grant 属于 Bearer 权限。Session 重放只需要持久业务标识和 Tool Result，不需要可重复使用的凭据。

## Consequences

Phase 1 保持只读：不报价、不预占或扣减积分、不入生成队列、不保存媒体、不修改画布。报价和生成提交必须通过独立合同实现确认、幂等、副作用前持久化和未知结果恢复。

Laravel 与 Agent 合同制品以兼容方式增加内部只读接口，不改变现有 `2026-08-25.1` Wire Version，因为已有请求和响应结构均未改变。双方在协议、Session、生成类型、缓存策略或响应结构不匹配时均失败关闭。
