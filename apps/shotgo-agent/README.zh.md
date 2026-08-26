# ShotGo Agent Runtime

[English](README.md) | 中文

ShotGo 的 Canvas、Image、Video 三类对话式 Agent 所使用的私有 DeepSeek Harness 组合程序。

Phase 0A 无需密钥且只读。它启动 mock 推理 Adapter，调用 `generation_config_read`，记录完整 Harness Session 回合，并返回确定性回答。它不连接 Laravel、不调用 AIGC 供应商、不扣积分、不提交生成任务，也不修改画布。

Phase 0B 在 [`contracts/`](contracts/README.zh.md) 中冻结 Laravel 边界。Phase 0B.2 把 Laravel 中加密落库的方舟凭据和供应商节点映射加载到进程内存。Canvas 承载的浏览器使用现有 Sanctum 身份取得受限 Grant；面向浏览器的 [Gateway 协议](contracts/gateway/README.zh.md) 通过 Laravel 内省实现幂等 Session 提交、取消和可重放 SSE。

Phase 1 将 `generation_config_read` 接入 Laravel 的“服务身份 + Grant 绑定”只读接口。Tool 返回当前可见的图片或视频模型、安全参数选项与约束以及默认值，供 Agent 识别仍需用户补充的选择。目录中的积分元数据只用于说明，不能代替 Laravel 报价或用户确认。Opaque Grant 只保留在当前活动 Session 的内存绑定中，绝不持久化；本阶段仍不报价、不扣积分、不提交生成任务、不修改画布。

Phase 2 增加只读 `generation_quote` Tool。Gateway 注入当前 Grant 与 Session 绑定，Laravel 重新验证授权上下文，Tool 返回包含规范化参数、准确积分明细、余额和有效期的短期 opaque Quote。报价既不扣积分也不提交任务；Agent 必须展示报价并请求用户明确确认。

Phase 3 增加紧邻 `generation_submit` 执行前的可信确认通道。Harness 通过 Gateway 发出已审计的 `approval.requested` 和 `approval.resolved` 事件，Canvas 通过绑定 Grant 与 Session 的接口回复待决策操作。只有 `allowed-once` 能放行该次精确工具调用；拒绝、取消、UI 不可用、过期决策和模型生成的“确认”文本均安全失败。

Phase 4 将已批准的 `generation_submit` Tool 接入 Laravel。Gateway 根据 Session 与 opaque Quote 派生稳定幂等 Key，只发送可信写上下文与报价，不接受模型提供用户、团队、价格或供应商字段。Laravel 重新验证 Grant、报价、当前模型配置、余额和冻结的账户上下文，在扣费前先占用现有请求唯一键，只提交一个任务；完全相同的重试安全重放，不会重复扣费或重复调用供应商。

Phase 5 增加权威 `generation_status` 与受审批保护的 `generation_cancel`。二者始终绑定创建任务的用户、可空团队、授权上下文和 Session。取消在行锁下解决与完成的竞争：排队任务会在 Worker 认领前退款；处理中任务只在本地停止，由于供应商可能已经计费，不执行不安全退款；已经终态的任务直接返回已有最终状态。

Phase 6 为已完成任务的状态结果增加稳定资产描述。Laravel 只返回用户、可空团队、来源和存储路径均与生成任务匹配的 `user_media_assets` 转存记录。Agent 只能得到不透明资产 ID、媒体类型、公开 HTTP(S) URL 和字节大小；供应商响应、供应商 URL 与私有存储路径继续隐藏。即使用户在 Worker 执行期间切换账户上下文，媒体转存也按生成任务冻结的团队上下文记账。

Phase 4A 使用 Gateway 协议 `2026-08-26.2` 传递结构化生成意图。图片上下文可以包含最多九个有序且不重复的 `parameters.referenceAssets`，每项只含正整数 `mediaLibraryItemId`；视频引用、原始 URL、路径、名称、字节和额外字段均被拒绝。Gateway 把 UI 选择写入 Harness Session，并用该选择替换模型提供的报价选项，同时保留 Agent 整理后的最终提示词。Laravel 解析素材归属与执行路径，并继续独占校验、定价、扣分、退款和幂等；模型可见的报价 Tool 不暴露引用字段。滚动发布顺序为 Agent、API、Canvas：明确声明 Gateway `2026-08-26.1` 的标量客户端与未声明版本的 `2026-08-25.1` 旧客户端保持兼容；Laravel 请求声明 `2026-08-26.1`，并在受限过渡期接受 `2026-08-25.1` 响应。

Phase 4B 只会在新 Laravel Grant 与模型不可见的 Gateway 恢复绑定中的用户、团队、空间、项目、模式、preset 和 runtime 版本完全一致时冷恢复持久 Session。绑定原子写入 Harness 日志旁，绝不包含 Grant 或凭据。每次在线实例化都有新的 `streamEpoch`，Canvas 因此会在重启后重置陈旧的进程内 cursor。中断的推理与审批会被关闭而不是恢复，下一条用户消息开始新的 Run。

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
- Laravel 运行时配置、推理策略、元数据用量、Grant 内省、生成配置、只读报价、可信确认、幂等生成提交、状态、恢复查询和取消客户端已经实现；资产投影和画布写入客户端仍未接通。
- 双方通过契约与集成验收前，资产投影和画布写入保持禁用。
- Gateway SSE 重放仍只存在于当前进程且最多保留 512 个事件。冷恢复会为下一轮恢复已完成的 Harness 历史，但不提供跨设备 Session 发现、多实例协调或未完成 Run 重放。
