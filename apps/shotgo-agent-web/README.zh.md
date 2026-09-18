# ShotGo Agent Web

[English](README.md) | 中文

ShotGo 私有产品前端。它与 Harness 上游 `apps/web` 分离，并以 `web/` 目录构建到 Agent 发布包中。

登录页和工作台均可切换亮色／暗色主题，默认使用亮色，并在当前 Origin 的浏览器存储中记住选择。工作流详情与对话消息共用一个可垂直滚动区域，滚动条始终可见且可用键盘操作；输入框固定在底部。

前端直接在 Agent Origin 登录并保存自己的 Bearer Token 和用户快照，不读取 Canvas LocalStorage。它通过 Laravel `/api/me` 恢复身份，发现身份过期时清理本地状态，通过 Laravel 切换既有个人/团队账户上下文，并且只加载当前上下文可见的项目。会话历史按用户、活动团队、媒体模式和 opaque Session ID 隔离。

Gateway Session Hook 会签发并静默续签短期 Capability Grant、幂等提交 Run、在每个事件后持久保存重放 Cursor；遇到旧 Run 的结束事件时先推进 Cursor，再连接当前 Run。它从版本化 Session 事件恢复 Assistant 文本，并支持取消；每个作用域最多保留五十条本地历史。例外决策投影只接受可重放的 Gateway `session.event`，且 `eventType` 必须为 `exception.decision`；前端按 Session 保存 Decision ID 和 Gateway Cursor，刷新后从 Laravel 恢复权威状态。浏览器使用自己的用户 Bearer Token 调用 Laravel 审批接口。Capability Grant 只用于带身份的 Gateway 流式连接，不进入 URL。

新会话默认手动模式，避免未配置自动执行策略时在提交阶段被阻断。手动 Run Start 确认每个 Skill Run 最多一次。配置有效自动执行策略后仍可切换自动模式，普通操作无需确认；硬预算或扩权，以及删除、跨项目、公开分享或发布动作仍走例外决策。

图片和视频 Composer 会加载 Laravel 生成配置，并在失败时使用安全的本地默认值；每个 Run 均携带结构化 `generationContext`，图片参考素材最多接收九个素材库 ID。Assistant 输出使用禁用 HTML 且过滤链接的 Markdown。可重放 Gateway Artifact 事件只按权威状态展示排队中、生成中、成功或失败的图片/视频卡，不虚构进度百分比。

图片参考现已使用可视化、可分页的 Laravel 素材库选择器，不再要求手填 ID。个人、组和团队范围继续由服务端鉴权；前端仅提交选中的图片 ID，支持跨页保留选择、恢复已知选中素材，并强制九张上限。该选择器有意不提供上传、删除、分享等素材库变更动作。

用户登录后，侧栏与创作时间线以 Laravel 账号级创作为权威：拉取会话列表与详情（用户文案 + generation 任务卡）。本机 localStorage 只作缓存，可丢。助手长文案和工具轨迹默认不上传；刷新后保留用户文案与成品卡。同步失败时提示「创作记录未能同步」，并继续展示已缓存或本机草稿。

## 合成 UAT 工作流

工作流解析器保留 v1/v2，并接受仅含元数据的 v3：约束与变更摘要、Brief／Plan 引用、已记录时间、五类 Gate 版本、返修引用及合成 Delivery。独立观察的合成收据提供累计费用和带引用的预算快照；报价不能证明结算。费用权威缺失时保持未知，Gate／Delivery 证据不完整时绝不认定可交付。离线 fixture（测试前置数据）不启用常规 Gateway 入口。已持久化的活动 Run 恢复不会再次提交消息；经重新鉴权且作用域匹配的事件流可重新绑定进程 epoch，并保留会话 cursor。已响应的手动确认 ID 在重放时保持已消费，结果未核清的失败 Run 保持锁定并提供明确的重连操作。仅有服务端历史而缺少活动指针时，不代表执行已恢复。

## 本机检查

```sh
pnpm --filter @shotgo/agent-web typecheck
pnpm --filter @shotgo/agent-web test
pnpm --filter @shotgo/agent-web build
```

应用路由 `/ai-tool/image-generator` 和 `/ai-tool/video-generator` 都回退到 SPA 入口。经单独批准，Canvas 兼容路由现已把两个旧独立页面跳转到 Agent Origin，且不转发浏览器状态；Canvas 内嵌 Agent 功能继续留在 Canvas。生产 Laravel CORS 和路由切换仍需人工部署。本应用不会读取 Canvas LocalStorage。
