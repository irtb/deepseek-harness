# ShotGo 发布包校验原生持久化组件

[English](2026-09-28-shotgo-release-native-durability-addon.md) | 中文

## 问题

生产 Gateway 的 `/healthz` 和 `/readyz` 均可通过，但首条已接受消息仍会因
`SESSION_DURABILITY_CHECKPOINT_FAILED` 失败。发布流程组装了 pnpm 生产依赖图，却没有构建 JSONL 会话持久化
所需的宿主原生 `flock` 组件。该二进制仅在首次使用时延迟加载，因此进程启动没有暴露发布包不完整的问题。

## 决策

- 生产发布包仅在 Linux x64 上构建，并在 `pnpm deploy` 前构建当前宿主的 Node-API `flock` 组件。
- 产物必须包含 glibc 组件文件，并携带一个小型发布校验器。
- 校验器通过已打包的持久化依赖解析 `flock`，创建一个仅属主可访问且可丢弃的探针，获取真实原生文件锁后删除探针。
- 离线打包流程会把最终归档解压到另一个目录并运行校验器。现网日常发布流程则在切换 `current` 前，以 `www-data`
  身份对 `storage/sessions` 运行相同校验器。

本变更不改变 Session、计费、生成任务、Laravel 或 Gateway 协议行为，只把首条消息时才暴露的延迟失败前移到发布切换前门禁。
