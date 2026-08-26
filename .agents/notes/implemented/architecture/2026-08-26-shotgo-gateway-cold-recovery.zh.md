# Agent Note: ShotGo Gateway 冷恢复

Status: implemented

[English](2026-08-26-shotgo-gateway-cold-recovery.md) | 中文

## Problem

Harness 已持久化对话日志，但 ShotGo Gateway 只在进程内存中保存授权绑定、在线 Agent handle、请求 cursor 和审批。进程重启后，有效 Session 因此无法访问。若只根据浏览器提供的 Session ID 恢复，刷新后的 Grant 还可能尝试把错误的用户、团队、项目或 Agent 模式绑定到已持久化的模型历史。

## Decision

Gateway 在每个 Harness Session 旁保存一份模型不可见、带版本的恢复绑定。文件包含 Session ID、Laravel 稳定 `authorizationContextId`、用户、可空团队、空间、可空项目、Agent 模式、可信 preset ID、runtime 版本和创建时间。文件绝不包含 Capability Grant、方舟凭据、供应商密钥、报价或审批决定。文件名使用 Session ID 的 SHA-256 摘要，目录与文件使用受限权限，并通过原子 rename 发布。

每次冷访问都先让 Laravel 使用当前 Grant 授权，再读取绑定，并要求所有已存作用域字段完全一致；当前 runtime 和模式专用 preset 也必须匹配。有效绑定通过公开的 `agents.resume()` 扩展点恢复持久日志，并挂载可信 ShotGo preset。缺失、格式错误、陈旧或不匹配的元数据均安全失败；Gateway 不会从 Session ID 或 Harness transcript 猜测归属。

每次在线实例化都会获得随机 `streamEpoch`。消息受理响应和每个 SSE 事件都会返回该 epoch。Canvas 在受理 Run 返回不同 epoch 时重置进程内 cursor，并拒绝其他 epoch 的事件。Harness persistence 在冷加载时关闭中断回合；Gateway 不继续模型调用，也不恢复待处理审批。后续用户消息会开始新的 Run。重启前已经提交的工作仍以 Laravel 生成状态和确定性提交键为权威。

恢复绑定始终归 `apps/shotgo-agent` 所有；上游 Harness package 不增加 ShotGo 行为或元数据字段。

## Alternatives considered

**向 `SessionHeader` 增加 ShotGo 授权字段。** 拒绝，因为这会为产品私有元数据修改上游持久格式，并扩大 fork 升级冲突。

**只凭 opaque Session ID 恢复任何既有 Session。** 拒绝，因为知道 ID 不代表拥有权限，也无法证明当前用户、团队、项目或模式拥有该 transcript。

**持久化 Capability Grant 以便重启恢复。** 拒绝，因为 Grant 是短期 bearer credential。每次访问都由 Laravel 重新签发并内省新 Grant。

**继续中断的模型调用或待处理审批。** 拒绝，因为崩溃修复会关闭中断回合，且进程状态与报价缓存丢失后，旧审批不能安全授权执行。

## Testing

Gateway 测试创建并完成一个 Session，释放第一套 Gateway service，再通过第二套 service 冷恢复；测试确认 Harness 日志保留两个用户回合、stream epoch 已变化，并拒绝 `authorizationContextId` 相同但项目不同的 Grant。契约和 Canvas 测试要求受理 Run 与 SSE 事件均包含 epoch。

## Consequences

单实例 Gateway 可以在重启后保留已完成对话历史，下一条已授权消息会继续同一个 Harness Session。重启后的事件流不会静默复用上一进程的内存 cursor。缺少绑定的旧 Session 会安全失败并要求新建 Session，而不会执行不安全迁移。跨设备 Session 发现、多实例协调、恢复未完成推理和复用重启前审批不属于本机制。
