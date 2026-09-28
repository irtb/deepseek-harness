# Agent 个人信息下拉对齐 Canvas

日期：2026-09-28
状态：设计已确认；实现计划已就绪（见 plans/2026-09-28-agent-user-menu-align-canvas.md）
范围：`agent.shotgo.cn/apps/shotgo-agent-web` 仅

## 目标

将 Agent 右上角个人信息下拉的 **UI 样式** 对齐 `canvas.shotgo.cn` 的 `UserMenu`，使两侧观感一致。业务字段、文案、交互逻辑保持不变。

权威对照：`canvas.shotgo.cn/src/components/auth/UserMenu.tsx`。

## 方案

方案 A：只改 Agent；用现有 BEM CSS + 内联 SVG 图标对齐 Canvas 视觉；不引入 `lucide-react` / Tailwind；不改 Canvas。

## 视觉对齐清单

以 Canvas 为基准，Agent 需达到：

1. **标题行**：左侧用户图标 +「个人信息」（带底部分隔线）。
2. **团队操作按钮**：左侧对应小图标（创建 / 进入团队 / 切换个人 / 团队管理 / 查看团队）；按钮为全宽描边圆角，文案与图标水平居中。
3. **主题行**：左侧对比度图标 +「模式切换」；右侧 Sun/Moon 双态圆形开关（替换 emoji ☀/☾）。
4. **退出登录**：左侧退出图标 + 文案；默认描边按钮；hover 红边 / 浅红底 / 红字。
5. **几何与层级**：触发器 pill、头像蓝紫渐变、面板圆角约 12–14px、内边距与分隔线密度与 Canvas 同级。
6. **浅色主题**：在现有 `:root[data-theme='light']` 下补齐新增图标/开关态颜色，避免浅色下对比不足。

## 实现落点

1. `apps/shotgo-agent-web/src/UserMenu.tsx`
   - 标题、团队操作、主题开关、退出按钮补齐内联 SVG（或小组件）。
   - 不改变 `teamMenuFlags`、切换团队、创建团队、跳转 Canvas、登出等逻辑。
2. `apps/shotgo-agent-web/src/styles.css`
   - 扩展 `.user-menu*` / `.user-menu-modal*` 以支撑图标布局与开关双态。
   - 同步 light 主题规则。
3. `apps/shotgo-agent-web/tests/user-menu.spec.tsx`
   - 既有用例继续通过；可增补「个人信息」「退出登录」可见性断言。

创建团队弹窗仅做与 Canvas 同级的轻微视觉对齐（关闭按钮、圆角、输入框），不改交互契约。

## 非目标

- 不修改 `canvas.shotgo.cn` / `api.shotgo.cn` / `console.shotgo.cn`。
- 不抽取跨仓共享组件包。
- 不改变菜单字段、权限可见性、跳转目标或费用/积分语义。
- 不部署、不推送。

## 验收

- 深色 / 浅色下，Agent 下拉与 Canvas 在图标、间距、主题开关、退出按钮上观感一致。
- hover / focus-within 仍可打开面板。
- 创建团队、进入/切换团队、积分跳转、登出行为与改前一致。
- `apps/shotgo-agent-web` 相关 Vitest 通过。
