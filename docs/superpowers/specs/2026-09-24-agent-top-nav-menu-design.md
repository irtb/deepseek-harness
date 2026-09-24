# Agent 顶部菜单与 Canvas 对齐

日期：2026-09-24
状态：设计已口头批准；待实现
范围：`agent.shotgo.cn/apps/shotgo-agent-web` 仅

## 目标

将 Agent 工作台顶部 `mode-tabs` 补全为与 `canvas.shotgo.cn` 项目列表页侧栏一致的四项菜单：名称、数量、顺序一致。

权威对照：`canvas.shotgo.cn/src/pages/ProjectsListPage.tsx` 侧栏 `nav`。

## 菜单契约

| 顺序 | 文案 | 目标 | active |
|------|------|------|--------|
| 1 | 无限画布 | `{CANVAS_ORIGIN}/projects` | 永不（跨站） |
| 2 | 图片生成 | `/ai-tool/image-generator` | `mode === 'image'` |
| 3 | 视频生成 | `/ai-tool/video-generator` | `mode === 'video'` |
| 4 | AI卡片生成 | `{CANVAS_ORIGIN}/ai-tool/batch-image` | 永不（跨站） |

跨站项使用整页 `<a href>` 导航，不做 SPA 路由劫持。

## 配置

新增 Vite 环境变量 `VITE_SHOTGO_CANVAS_ORIGIN`：

- production：`https://canvas.shotgo.cn`
- development：`http://localhost:5173`
- 代码缺省回退：`https://canvas.shotgo.cn`

提供小工具 `buildCanvasAppUrl(path)`（或等价命名）：校验 origin 为 http(s)、无 userinfo，返回 `{origin}{path}`。

## 实现落点

1. 新增 canvas origin / URL 构建模块（可单测）。
2. `.env.example` / `.env.development` / `.env.production` 写入上述变量。
3. `AgentWorkspace.tsx` 顶部 `mode-tabs` 改为按上表四项渲染；样式沿用现有 `.mode-tabs`。
4. `workspace` 相关测试：断言四项文案与顺序、跨站绝对 URL、本站 active。

## 非目标

- 不修改 `canvas.shotgo.cn` / `api.shotgo.cn` / `console.shotgo.cn`。
- 不修正 BatchImage 页侧栏菜单不完整问题。
- 不改变 Agent 图/视频业务逻辑、路由入口数量（仍仅 image/video 两个 mode 页面）。
- 不部署、不推送。

## 验证

- 相关 Vitest 通过。
- 手动：Agent 图片页可见四项；点无限画布 / AI卡片生成跳到配置的 Canvas origin；图/视频切换 active 正确。
