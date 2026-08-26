# Agent Note: 结构化生成意图与可信报价确认

Status: implemented

[English](2026-08-26-structured-generation-intent-and-trusted-quote-confirmation.md) | 中文

## 问题

ShotGo 图片和视频 Composer 会显示生成设置，但 Gateway 只接受自由文本。因此模型可以在报价前改变可见选择。提交确认还会渲染模型在 `generation_submit` 参数中填写的 `kind`、`modelId` 和 `credits`，而 Laravel 实际按不透明报价扣分。模型可能显示一个低于 Laravel 实际执行报价的数值。

## 决策

Gateway 协议 `2026-08-26.1` 接受可选且经过严格校验的 `generationContext`，其中包含图片或视频类型、模型 ID 和标量参数选择。上下文类型必须与 Grant 绑定的 Agent 模式一致。Gateway 将原始用户请求与结构化上下文序列化为确定性的 JSON，写入模型可见的用户消息；它把上下文绑定到当前 Run，并在 `generation_quote` 调用 Laravel 时只覆盖用户已选的标量值。Agent 生成的提示词仍作为报价提示词。该绑定在 Run 结束时清除。

结构化上下文只代表已经认证的用户意图，不代表授权或报价权威。Laravel 继续校验模型和参数，并独占报价、扣分、退款及生成幂等。Gateway Schema 拒绝原始 URL、路径、文件字节和未范围化附件；协议 `2026-08-26.2` 增加[图片素材范围引用](2026-08-26-scoped-image-media-references.zh.md)定义的范围化素材 ID。

每个通过验证的 Laravel 报价都会按 Session 和报价 ID 写入进程内注册表，每个 Session 最多保留 16 条、全局最多保留 512 条。确认门禁会原子消费一条未过期记录，并渲染其中的 Laravel 模型、规范化参数和积分。`generation_submit` 只接受 `quoteId` 与 `quoteVersion`，不再存在模型提供的展示字段。报价已使用、缺失、过期或版本不匹配时安全失败，并要求重新报价。

## 曾考虑的替代方案

**只把选择编码进自然语言提示词。** 否决，因为模型可能重新解释或遗漏选择，而且用户文本中的分隔符可能使投影产生歧义。

**让浏览器直接提交或批准 Canvas 报价。** 否决，因为 Canvas 报价并不是 `generation_submit` 消费的 Grant 绑定不透明 Agent 报价；混用可能导致展示一个价格却执行另一个价格。

**保留模型提供的确认字段，只依赖 Laravel 在提交时校验。** 否决，因为 Laravel 能保证扣分正确，却不能保证用户是在知情条件下确认。

**在同一协议版本接受附件 URL。** 否决，因为附件归属、媒体类型、角色和生命周期必须由 Laravel 根据范围化素材 ID 解析。标量设置先独立交付，附件合同仍保持缺失。

## 测试

Gateway 测试覆盖合法结构化上下文，并拒绝未知媒体 URL 字段。Runtime 测试覆盖可信报价确认、模型伪造展示字段、缺失报价、拒绝、取消和既有生成生命周期。类型检查与完整 Runtime 测试套件覆盖新服务注册和协议类型。

## 后果

可见标量设置不会因模型漂移而偏离 Laravel 报价，批准金额始终来自 Laravel 将要执行的同一个报价。Gateway 重启会丢弃待确认报价注册记录，因此中断的确认必须重新报价；这是有意的安全失败行为。协议 `2026-08-26.1` 保持为仅标量的兼容版本，[协议 `2026-08-26.2`](2026-08-26-scoped-image-media-references.zh.md)负责范围化图片素材引用和当前滚动发布顺序。
