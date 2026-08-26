# Agent Note: 范围化图片素材引用

Status: implemented

[English](2026-08-26-scoped-image-media-references.md) | 中文

## 问题

图片 Agent 用户需要选择已有 ShotGo 素材作为生成参考。浏览器路径和 URL 不是安全标识符：它们可能越过已认证素材范围、暴露存储布局、随存储变化而漂移，并允许模型替换用户未选择的资源。

## 决策

Gateway 协议 `2026-08-26.2` 接受图片 `generationContext.parameters.referenceAssets`，其值为最多九个有序且不重复的对象。每个对象只含一个正安全整数 `mediaLibraryItemId`。视频上下文、重复 ID、原始 URL、路径、名称、字节和额外字段均以 `GENERATION_CONTEXT_INVALID` 失败。明确声明的 `2026-08-26.1` 保持仅标量能力，未声明版本的请求获得旧版 `2026-08-25.1` 投影。

Gateway 把这些 ID 写入模型可见的确定性生成上下文，但不在 `generation_quote` Tool Schema 中暴露引用参数。模型调用该 Tool 时，Gateway 丢弃模型提供的生成选项，并把 UI 选择的 `referenceAssets` 注入 Laravel 报价请求。Laravel 验证归属和素材适用性，只在 `normalizedParameters.referenceAssets` 中返回相同 ID 对象，并仅在加密执行 Envelope 内保存解析后的可信相对路径。Agent Runtime 永远得不到这些路径。

Laravel 请求协议 `2026-08-26.1` 承载该报价格式。Agent 客户端发送该版本，并在过渡期接受响应 Header 与 Body 声明 `2026-08-26.1` 或 `2026-08-25.1`。部署顺序为 Agent、API、Canvas。只有 Agent 与 API 能够联动回滚且不再提供旧 API 后，才能移除上一 Laravel 响应版本；Gateway 兼容版本则保留到对应 Canvas 构建不再被提供或缓存。

## 曾考虑的替代方案

**发送浏览器 URL 或存储路径。** 否决，因为两者都不能证明归属，都会把存储细节泄漏到 Wire 外，而且 URL 可以指向当前账户范围外的内容。

**向模型可见的报价 Schema 暴露素材引用。** 否决，因为模型可能在用户完成选择后重新排序、遗漏或替换 ID。由 Gateway 注入才能保留已认证的 UI 意图。

**在 Agent Runtime 解析 ID。** 否决，因为 Laravel 负责素材记录、账户范围、存储路径和加密生成 Envelope。在 Agent Runtime 重复该查询会复制授权逻辑并暴露执行路径。

**在同一版本增加视频引用。** 否决，因为已批准的 Phase 4A.2a API 只解析图片引用合同。视频输入角色和供应商映射冻结前继续采用失败关闭。

## 测试

Gateway 测试只在 `2026-08-26.2` 下接受有序图片素材 ID，并拒绝无效数字、重复项、超量项、额外字段、上一版本引用和视频引用。Session 测试证明 UI 引用会替换模型参数并进入 Laravel 报价请求。契约和客户端测试固定 Gateway Schema、Laravel 报价 Schema、当前请求版本、受限上一响应版本兼容，以及对畸形规范化引用的拒绝。

## 后果

浏览器无需发送路径或 URL 即可引用已有图片，模型无法在报价前改变已选素材。Laravel 执行唯一的归属解析，并使执行路径不进入 Agent 可见数据。兼容窗口会暂时增加一条响应解析分支，回滚窗口关闭后需要协调移除。视频引用生成仍不可用。
