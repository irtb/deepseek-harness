# Agent Note: Laravel 托管的方舟运行时配置

Status: implemented

[English](2026-08-24-shotgo-laravel-managed-ark-runtime-configuration.md) | 中文

## Problem

Harness 必须直接调用火山方舟推理端点，避免 Laravel 代理长时间模型流；同时 ShotGo 运维需要通过一个生产控制面配置供应商凭据和节点 ID。如果 Agent 环境另行保存 Key 和模型映射，系统会形成两套配置权威，管理后台的轮换无法覆盖完整链路，已部署 Adapter 也可能偏离团队策略引用的 Laravel 模型记录。

## Decision

Laravel 是方舟 API Key 以及逻辑模型 `deepseek-v4-flash`、`deepseek-v4-pro` 对应供应商节点 ID 的存储权威。API Key 使用 Laravel 加密模型转换器，供应商节点 ID 作为普通模型配置保存。发布导入器读取工作站部署变量，并通过标准输入写入通用配置；Laravel 应用代码和 Harness 都不识别这些部署变量名。

当前 Laravel Wire 协议包含 `GET /api/internal/agent/v1/inference-runtime-config`。该端点只接受 Agent 服务 Bearer Token。成功响应包含 `Cache-Control: no-store`、供应商 Base URL、解密后的 Key、两个不同的供应商节点 ID 和不透明配置版本。数据库配置缺失、禁用、重复、无法解密或不完整时，接口返回可重试的 `INFERENCE_RUNTIME_CONFIG_UNAVAILABLE` Problem，不返回任何部分密钥。

Agent Runtime 在 HTTP 边界校验响应，只在进程内存保留一份不可变副本，并在任何刷新失败后清除 readiness。`ShotGoArkLlmAdapter` 继续向 Harness 暴露逻辑模型名，同时在方舟请求中发送映射后的供应商节点 ID。凭据和供应商节点 ID 都不会进入浏览器响应、Capability Grant、Harness Session 事件、用量报告、命令参数或应用日志。

方舟推理仍在 Agent 进程中执行并复用公共 `DeepSeekAdapter` 传输，因此 Laravel Worker 不承载 Token 流。Laravel 继续提供团队策略，并在每次推理后接收仅含元数据的用量。业务文本、图片、视频和音频生成继续通过 Laravel Capability API，沿用其报价、积分、队列、资产和退款权威。

`ve-shotgo` 发布继续使用 `/data/projects/agent.shotgo.cn`、Supervisor、`www-data` 和预构建校验包。Agent 环境在该配置链路中只包含 Laravel Base URL 和 Agent 服务 Token，不包含方舟 Key 或供应商模型 ID。readiness 同时要求显式开启流量以及当前进程内存在有效运行时配置。

## Alternatives considered

**由 Agent 环境变量保存方舟配置。** 这使 Runtime 启动后更独立，但会复制生产配置权威并绕过数据库模型管理流程。Laravel 服务端点统一轮换入口，同时仍由 Agent 直连推理。

**Laravel 推理代理。** 这使 Key 不进入 Agent 进程，但会占用 PHP-FPM 承载长时间模型流、重复 SSE 与 Tool Call 翻译，并为每个 Token 增加故障节点。Laravel 只下发配置，不代理推理流。

**在 Capability Policy 中返回凭据。** 这可以少一个端点，但会通过浏览器可调用的用户范围链路暴露服务凭据。服务配置和用户策略保持不同的认证方式。

**直连所有 AIGC 供应商。** 这会让 Agent 使用统一传输模型，但会绕过 ShotGo 的报价、积分、队列、资产、退款和供应商路由规则。只有 Agent 推理直连方舟。

**复制上游 DeepSeek Adapter。** 这便于任意修改模型映射，但会在 Fork 内再次形成 Fork。ShotGo Adapter 继承公共实现，并使用一次捕获的配置快照委托每个映射请求。

**在服务器从 GitHub 安装并构建。** 这会让发布依赖海外网络可用性和可变依赖解析。ShotGo 改为向北京服务器传输预构建且带校验和的发布包。

## Consequences

ShotGo 获得方舟凭据与节点映射的单一运维权威，同时保留低延迟直连推理和上游流式行为。Laravel 应用 Key 与数据库同时泄露时可能暴露供应商凭据，Agent 进程被攻破时也可能读取内存副本，因此仍需轮换服务 Token、隔离主机、禁止缓存、避免日志泄密并限制进程权限。无密钥启动和确定性 Snapshot 保持可用，但 Laravel 配置完整前，真实推理和 readiness 都采用失败关闭。契约测试固定服务认证、响应校验、逻辑模型映射、内存失效和 readiness 行为；真实 Key 方舟调用属于生产验收步骤，不进入仓库测试。
