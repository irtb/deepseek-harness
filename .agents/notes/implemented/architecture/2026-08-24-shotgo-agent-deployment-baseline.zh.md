# Agent Note: 增加关闭式失败的 ShotGo 部署基线

Status: implemented

[English](2026-08-24-shotgo-agent-deployment-baseline.md) | 中文

## Problem

`agent.shotgo.cn` DNS 已指向共享生产服务器 `ve-shotgo`，但服务器上存在运行中的 Laravel Worker、Reverb 进程以及带本地改动的 Laravel 工作树。Agent Runtime 尚无生产监听服务、Node Runtime、服务单元、独立证书和健康检查契约。直接部署 Phase 0A smoke executable 或修改共享服务，会制造虚假就绪状态并增加生产风险。

## Decision

在 ShotGo 产品边界内增加独立部署基线。Gateway 只监听回环地址，将存活与就绪检查分离，要求不可变部署 ID，并且只有显式启用流量时才开放 readiness。提供版本化环境、systemd 与 Nginx 模板，分别使用独立服务账户、发布软链接、端口、证书和日志文件。

首次部署仅验证契约，不开放 Agent Session 路由，也不连接 Laravel、推理、计费、生成或画布写入。现有 PHP、Redis、Supervisor、Laravel 仓库、Worker 和 Reverb 均不在修改范围内。HTTPS 安装必须依次完成备份、`nginx -t`、独立证书和 reload。

## Consequences

基础设施可以在不宣称产品就绪的情况下验证 DNS、TLS、进程守护、回环代理、回滚目录和可观测性。`/healthz` 可以返回 200，而 `/readyz` 有意返回 503。Laravel 协议集成和端到端验收完成前，公开业务流量保持关闭。

## Alternatives considered

- 使用 Supervisor 部署 Phase 0A CLI：否决，因为它是一次性 smoke executable，不是网络服务。
- Node 直接监听公网端口：否决，因为 TLS、请求限制和公网暴露应由 Nginx 负责。
- 复用现有 Laravel 证书：否决，因为其 SAN 不包含 `agent.shotgo.cn`，扩展证书会耦合无关站点。
- 使用 mock 集成开放 readiness：否决，因为这会把无法执行已接受业务操作的服务错误标记为就绪。
