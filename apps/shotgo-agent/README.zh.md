# ShotGo Agent Runtime

[English](README.md) | 中文

ShotGo 的 Canvas、Image、Video 三类对话式 Agent 所使用的私有 DeepSeek Harness 组合程序。

Phase 0A 无需密钥且只读。它启动 mock 推理 Adapter，调用 `generation_config_read`，记录完整 Harness Session 回合，并返回确定性回答。它不连接 Laravel、不调用 AIGC 供应商、不扣积分、不提交生成任务，也不修改画布。

Phase 0B 在 [`contracts/`](contracts/README.zh.md) 中冻结 Laravel 边界。Phase 0B.2 把 Laravel 中加密落库的方舟凭据和供应商节点映射加载到进程内存。Canvas 承载的浏览器使用现有 Sanctum 身份取得受限 Grant；面向浏览器的 [Gateway 协议](contracts/gateway/README.zh.md) 通过 Laravel 内省实现幂等 Session 提交、取消和可重放 SSE。

Phase 1 将 `generation_config_read` 接入 Laravel 的“服务身份 + Grant 绑定”只读接口。Tool 返回当前可见的图片或视频模型、安全参数选项与约束以及默认值，供 Agent 识别仍需用户补充的选择。目录中的积分元数据只用于说明，不能代替 Laravel 报价或用户确认。Opaque Grant 只保留在当前活动 Session 的内存绑定中，绝不持久化；本阶段仍不报价、不扣积分、不提交生成任务、不修改画布。

Phase 2 增加只读 `generation_quote` Tool。Gateway 注入当前 Grant 与 Session 绑定，Laravel 重新验证授权上下文，Tool 返回包含规范化参数、准确积分明细、余额和有效期的短期 opaque Quote。报价既不扣积分也不提交任务；Agent 必须展示报价并请求用户明确确认。

## 本地 Smoke

```sh
pnpm --filter @shotgo/agent-runtime run dev -- "我能使用哪些图片模型？"
```

## 聚焦检查

```sh
pnpm --filter @shotgo/agent-runtime run typecheck
pnpm --filter @shotgo/agent-runtime run test
pnpm --filter @shotgo/agent-runtime run test:contract
pnpm --filter @shotgo/agent-runtime run test:gateway
```

## 部署基线

生产部署基线记录在 [`deploy/`](deploy/README.zh.md)。它构建仅监听回环地址的 Gateway，并分离 `/healthz` 与 `/readyz`。Laravel v1 集成验收明确启用流量前，readiness 默认返回 `503`。

## 架构

- `config/base.cordis.yml` 组装 Phase 0A Host Plane。
- `config/agent-presets/` 保存三个可信 Agent Plane 组合。
- `src/llm/` 负责 Harness LLM Provider 实现。
- `src/tools/` 负责共享的模型可见 ShotGo Tool。
- `contracts/` 保存独立版本管理的 Laravel 控制面协议与浏览器 Gateway 协议。
- Laravel 始终负责身份、权限、模型、计费、画布状态、生成任务和资产。

## Model Experience

Phase 0A mock 总是请求只读 `generation_config_read` Tool，然后解释其结果。它不调用供应商模型，因此 transcript 无需密钥且完全确定。Phase 0B 之后替换 mock 只改变推理 Provider，不改变业务生成能力的归属边界。

#### KV Cache effect

三个 Preset 使用不同 Persona 文本。同一个 Preset 内，Prompt 和 Tool Schema 在不同回合之间保持稳定；Phase 0B 之后，动态 Laravel capability 结果只作为 Tool Result 出现。

## Known Limitations and Deferred Work

- 无密钥 executable 仍是 Phase 0A smoke 入口；`gateway-bin` 是生产进程入口。
- `gateway-bin` 已挂载受限 Harness Runtime、可信模式 Preset、Laravel Grant Authorizer、Session 提交、SSE 重放与取消；Laravel 完成并验收 Grant 签发和内省前，生产接入保持关闭。
- Laravel 运行时配置、推理策略、元数据用量、Grant 内省、生成配置和只读报价客户端已经实现；可变更业务状态的 Capability 客户端仍未接通。
- 双方通过契约与集成验收前，计费、生成提交和画布写入保持禁用。
- Gateway 重放仅存在于当前进程且最多保留 512 个事件；尚未接通根据持久化 Harness Session 日志进行的重启恢复。
