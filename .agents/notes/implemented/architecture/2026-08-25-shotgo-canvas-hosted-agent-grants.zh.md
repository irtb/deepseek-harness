# Agent Note: 使用受限 Grant 授权 Canvas 承载的 Agent Session

Status: implemented

[English](2026-08-25-shotgo-canvas-hosted-agent-grants.md) | 中文

## Problem

Agent 界面运行在 `canvas.shotgo.cn` 中，而该应用已经使用 Sanctum 向 Laravel 认证用户。单独的交接票据会重复这条已认证入口；把账号级 Sanctum Token 转发给 `agent.shotgo.cn`，又会让独立 Runtime 获得超过单个 Agent Session 所需的权限。不透明 Grant 如果只校验用户身份，也无法安全授权 Session：同一用户可能同时使用个人空间、团队空间或多个项目。

## Decision

Canvas 浏览器使用现有 Sanctum Bearer Token 调用 `POST /api/agent/v1/grants`。Laravel 从已认证主体推导 `userId` 和可为空的 `teamId`，验证请求的空间、可为空的项目、Agent 模式与当前推理模型可用性，并返回短期不透明 Grant。请求体不包含用户或团队身份；个人上下文保留 `teamId: null`，禁止构造伪团队。个人账号继续使用已有的启用推理模型来源，并与团队账号使用相同的 DeepSeek 逻辑模型；团队上下文再叠加现有团队授权过滤。

Agent Runtime 使用服务身份认证，把不透明 Grant、目标 Session id 和一项必需操作能力发送到 `POST /api/internal/agent/v1/grants/introspect`。Laravel 返回禁止缓存的授权结果，其中稳定的 `authorizationContextId` 绑定用户、可为空的团队、空间、可为空的项目、Agent 模式与 Session，并携带获批推理路由。Runtime 不解码、不持久化，也不记录 Grant。

消息提交、事件读取与取消使用不同能力。刷新后的 Grant 只有在内省返回相同授权上下文时才能访问活动 Gateway Session；仅用户身份相同并不充分。Gateway CORS 只允许配置的 Canvas Origin，支持 Bearer 与重放 Header 的预检，并且不启用浏览器 Cookie 凭据。

生产 Gateway 启动受限 Harness Runtime，为每个已授权 Session 挂载一个可信模式 Preset，并在暴露 Session 路由前安装 Laravel 内省。部署构建生成独立的已编译 Cordis 配置，生产环境不会通过 Node 的 strip-only Loader 加载 TypeScript 源码。

## Alternatives considered

**保留一次性交接票据。** 否决，因为浏览器没有离开已认证的 Canvas 应用；第二次身份传递没有跨越应用边界，却会增加过期与重放状态。

**把 Sanctum Token 直接发送给 Agent Gateway。** 否决，因为账号 Token 可以访问无关的 ShotGo API，会扩大 Gateway、日志或插件泄露的影响范围。

**在 Runtime 本地校验自包含 Grant。** 否决，因为吊销、成员关系、模型授权与项目访问始终由 Laravel 管理，而且可能在 Token 过期前发生变化。

**只把 Session 绑定到用户 id。** 否决，因为同一用户可能拥有互不相关的个人、团队、空间和项目上下文；只比较用户会允许跨上下文复用 Session。

## Consequences

Canvas 复用现有登录，不需要第二套前端认证系统。Agent Gateway 只获得 Session 范围的权限，并在 Laravel、必需能力、推理路由或准确授权上下文不可用时关闭式失败。每个交互式 Gateway 请求会增加一次 Laravel 内省调用，因此 Laravel 的可用性和延迟会参与 Session 接入，缓存不得削弱吊销或过期语义。
