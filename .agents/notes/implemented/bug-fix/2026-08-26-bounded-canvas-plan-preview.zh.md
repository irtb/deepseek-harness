# Agent Note: 在每个解析入口限制 Canvas 计划预览

Status: implemented

[English](2026-08-26-bounded-canvas-plan-preview.md) | 中文

## Problem

Canvas 计划工具只校验总数量、节点标识闭包和预估积分，仍会接受空白或超长文本、自环和重复依赖。浏览器对实时 Gateway 输出与本地存储使用不同规则，因此无效计划可能实时显示，却在刷新后被拒绝。

## Decision

`canvas_plan_preview` 拒绝空计划、空白或超长的摘要、模型、节点标识与名称、重复节点标识、自环、重复依赖、指向声明节点集合外部的依赖、非整数积分估算和总数量越界。

Canvas 对受跟踪的 Gateway 工具结果与持久化聊天历史共用一个 `isAgentCanvasPlan` 校验器。只有有效、只读且要求确认的计划才能生成或恢复计划卡。

## Testing

装配后的 Tool Runtime 在不使用推理密钥的情况下覆盖有效输出和每一类拒绝情况。Canvas 事件与存储测试覆盖依赖闭包、空白文本、重复节点、自环、重复依赖和未跟踪的工具结果。

## Alternatives considered

**只依靠浏览器清理模型输出。** 不采用，因为畸形数据仍会进入 Harness Session，并可能被不同客户端以不同方式解释。

**为实时与存储保留两个校验器。** 不采用，因为同一份持久数据仍会存在两套可能漂移的接受规则。

## Consequences

计划卡在 Agent Runtime、Canvas 实时事件和浏览器恢复中具有同一个受限表示。限制会刻意排除异常庞大的规划图；用户需要把这类工作流拆成较小计划。计划仍只用于说明，不能授权计费或 Canvas 写入。
