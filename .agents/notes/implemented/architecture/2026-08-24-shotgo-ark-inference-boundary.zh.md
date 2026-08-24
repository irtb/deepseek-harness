# Agent Note: ShotGo 方舟推理边界

Status: implemented

[English](2026-08-24-shotgo-ark-inference-boundary.md) | 中文

## Problem

如果每一轮 Harness 推理都经 Laravel 转发，凭据和策略会集中在一个服务中，但 PHP-FPM 也必须承载长时间模型流、重复实现 Harness Provider 协议、在每个 Token 前增加一跳，并使 Agent 可用性依赖 Laravel 的流式容量。业务 AIGC 生成仍需要 Laravel 的事务、队列、报价、积分、资产和退款，因此也不能把所有模型调用都迁入 Agent Runtime。

## Decision

ShotGo 采用数据面与控制面混合设计。`ShotGoArkLlmAdapter` 注册 `volcengine-ark` Harness Provider，复用公共 `DeepSeekAdapter` 传输能力，通过 Agent Host Plane 的 `ARK_API_KEY` 调用 `https://ark.cn-beijing.volces.com/api/v3`。产品策略只允许 `deepseek-v4-flash` 和 `deepseek-v4-pro`。Laravel 提供具有有效期的推理策略并接收幂等、仅含元数据的用量报告；它不接收供应商密钥、提示词、消息、回答或原始供应商响应。所有业务文本、图片、视频和音频生成继续经过 Laravel Capability API。

Wire 版本为 `2026-08-24.1`。该版本删除 `/api/internal/agent/v1/inference/stream`，增加 `/api/agent/v1/inference-policy` 和 `/api/internal/agent/v1/inference-usage`。策略缺失、过期、不匹配或扩大授权时采用失败关闭。用量报告以 `llmRequestId` 标识，并把它同时作为 `Idempotency-Key`。

`ve-shotgo` 部署遵循现有 ShotGo 服务约定：`/data/projects/agent.shotgo.cn`、Supervisor、`www-data`、`/data/nginx/conf.d` 和 `/data/nginx/logs.d`。构建和依赖解析在服务器切换前完成，通过 SSH 传输带校验和的发布包，使北京服务器发布不依赖容易受 GFW 影响的软件仓库。

## Alternatives considered

**Laravel 推理代理。** 它集中管理密钥和请求流，但会占用 PHP-FPM 容量、重复 SSE 与 tool call 翻译，并增加可避免的延迟和故障节点，因此 Laravel 改为只负责控制面。

**直连所有 AIGC 供应商。** 这会让 Runtime 统一拥有传输职责，但会绕过 ShotGo 的报价、积分、队列、资产、退款和供应商路由规则，因此只有独立的 Agent 推理凭据迁移到 Host Plane。

**把上游 DeepSeek Adapter 复制进产品 App。** 这便于任意修改，但会在 fork 内再次形成 fork，使上游修复难以合入。产品继承公共 Adapter，仅增加 Provider 身份和模型策略。

**在服务器从 GitHub 安装并构建。** 这类似传统工作树部署，但会让发布依赖海外网络和可变解析结果。ShotGo 保留相同服务器目录和进程管理方式，同时传输预构建、带校验和的发布包。

## Consequences

推理流不再占用 Laravel Worker，产品继续使用上游的流式、reasoning、tool call、usage、retry 和取消语义。Agent 服务新增方舟凭据轮换、供应商出网可用性、限流观测与用量元数据投递职责。开放 readiness 前，Laravel 与 Runtime 必须联合执行相同的策略版本和预算。真实 Key 方舟验收和 Laravel 集成测试仍是部署门禁；未配置 `ARK_API_KEY` 时，无密钥启动和 snapshot 继续可用。
