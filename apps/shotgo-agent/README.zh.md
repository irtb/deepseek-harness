# ShotGo Agent Runtime

[English](README.md) | 中文

ShotGo 的 Canvas、Image、Video 三类对话式 Agent 所使用的私有 DeepSeek Harness 组合程序。

Phase 0A 无需密钥且只读。它启动 mock 推理 Adapter，调用 `generation_config_read`，记录完整 Harness Session 回合，并返回确定性回答。它不连接 Laravel、不调用 AIGC 供应商、不扣积分、不提交生成任务，也不修改画布。

Phase 0B 在 [`contracts/`](contracts/README.zh.md) 中冻结 Laravel 边界。该契约已经可以供 Laravel 与 Agent Runtime 分别实现；双方通过契约测试前，仍禁止真实写入和计费。

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
- `contracts/` 保存已冻结的 OpenAPI 与 JSON Schema Laravel 协议。
- Laravel 始终负责身份、权限、模型、计费、画布状态、生成任务和资产。

## Model Experience

Phase 0A mock 总是请求只读 `generation_config_read` Tool，然后解释其结果。它不调用供应商模型，因此 transcript 无需密钥且完全确定。Phase 0B 之后替换 mock 只改变推理 Provider，不改变业务生成能力的归属边界。

#### KV Cache effect

三个 Preset 使用不同 Persona 文本。同一个 Preset 内，Prompt 和 Tool Schema 在不同回合之间保持稳定；Phase 0B 之后，动态 Laravel capability 结果只作为 Tool Result 出现。

## Known Limitations and Deferred Work

- 当前 executable 是 Phase 0A smoke 入口，不是生产 Gateway。
- Preset discovery 和按 Session 选择已经声明，但尚未接入公开 Session API。
- Laravel 与 Agent Runtime 尚未连接已冻结的 v1 协议实现。
- 双方通过契约与集成验收前，计费、生成提交和画布写入保持禁用。
- 当前部署 Gateway 仅提供健康与就绪检查，尚未实现公开 Agent Session 路由。
