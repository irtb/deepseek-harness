# Agent Note: ShotGo generation config capability

Status: implemented

[English](2026-08-25-shotgo-generation-config-capability.md) | 中文

## Problem

Phase 0A 的 `generation_config_read` Tool 返回确定性 Fixture。Phase 1 需要保持同一模型可见 Tool，同时根据 Laravel 当前对已认证 ShotGo 主体的授权，返回可用图片或视频模型，并且不引入计费和生成副作用。

## Decision

Laravel 在 Agent 服务身份认证下提供 `POST /api/internal/agent/v1/generation/config`。每个请求同时携带浏览器签发的 opaque Grant、Session id 和请求的生成类型。Laravel 解析 Grant，重新验证当前用户、团队和可选项目范围，检查 `generation.config.read`，约束 Agent 模式对应的生成类型，并返回禁止缓存的模型目录。

Gateway 仅在活动 Harness Agent Scope 的内存中绑定当前 opaque Grant。只有常规 Session 提交内省返回相同授权上下文后，刷新后的 Grant 才替换该绑定。Scope 内的 `generation_config_read` Tool 通过窄接口 Reader 调用 Laravel，并转发取消信号。Grant 和服务 Token 均不会进入 Harness Session 事件、Tool Result、运行配置文件或业务数据库记录。

无密钥入口继续保留确定性 Fixture，作为本地 Smoke 回退；生产 `gateway-bin` 始终安装 Laravel Reader。投影给模型的响应包含请求类型、可见模型元数据、安全选项约束以及 `parameterSchemaVersion: 1` 下的默认值，并排除授权上下文、Session 身份、凭据、供应商字段、上游 Key 和定价规则。目录中的积分元数据只说明选项差异，不能代替 Laravel 报价或用户确认。模型可用性和参数的最终权威仍是 Laravel。

普通图片 Agent 请求固定表示生成一张图片。其模型可见目录、Gateway 上下文和 `generation_quote` Schema 均不包含 Laravel 的 `multiples` / `multipleId` 字段，因为这些字段属于既有 `image.hd_enhance` 操作，并不表示普通生图数量。Gateway 只为旧浏览器信封兼容接收该字段，并在进入 Session 前删除。未来如需图片数量，必须独立实现数量感知报价、幂等子任务、部分失败退款和多资产持久化合同。

## Alternatives considered

**由 Harness 复用浏览器 Sanctum 接口。** 放弃，因为这会把账户级浏览器凭据转发给独立 Agent Runtime，并绕过 Session 级 Grant 边界。

**在 Grant 内省响应中返回模型目录。** 放弃，因为接入授权和业务配置的缓存、调用频率、演进节奏不同。独立读取允许 Tool 刷新 Laravel 权威模型状态，而无需重新定义 Session 身份。

**把 Grant 持久化到 Harness Session。** 放弃，因为 Grant 属于 Bearer 权限。Session 重放只需要持久业务标识和 Tool Result，不需要可重复使用的凭据。

## Consequences

Phase 1 保持只读：不报价、不预占或扣减积分、不入生成队列、不保存媒体、不修改画布。报价和生成提交必须通过独立合同实现确认、幂等、副作用前持久化和未知结果恢复。

Laravel 端点在原有响应中增加参数目录而不改变 `2026-08-25.1`；私有部署先发布 Laravel，再发布要求 `parameterSchemaVersion: 1` 的 Agent，回滚时先取消 Agent 侧要求再回退 Laravel。双方在协议、参数 Schema、Session、生成类型、缓存策略、未知字段、无效默认值或非法约束出现问题时均失败关闭。

该 Agent 专用投影不改变共享 Canvas 生成配置，也不改变 `image.hd_enhance` 的放大倍数行为。
