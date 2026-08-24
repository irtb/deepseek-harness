# ShotGo Agent 部署基线

[English](README.md) | 中文

该基线只部署监听回环地址的 Gateway，以及存活与就绪端点。它不启用 Laravel 集成、推理、计费、生成、画布写入或公开 Agent Session。

## ve-shotgo 预检快照

2026-08-24 已核验：Ubuntu 24.04、Nginx 1.24、Certbot 2.9、Redis 和 Supervisor 已存在；尚未安装 Node、pnpm 和 Docker。当前 Laravel 队列 Worker 与 Reverb 正在运行，且 `/data/projects/zswx_canvas_api` 存在本地改动。本次部署不得修改或清理该工作树，也不得重启其 Worker。

## 发布目录

- 不可变发布目录：`/data/projects/agent.shotgo.cn/releases/<git-sha>`；
- 当前版本软链接：`/data/projects/agent.shotgo.cn/current`；
- 环境文件：`/etc/shotgo-agent/shotgo-agent.env`，权限 `0600`；
- 服务账户：`shotgo-agent`，禁止登录；
- 服务文件：`/etc/systemd/system/shotgo-agent.service`；
- Nginx 虚拟主机：`/data/nginx/conf.d/agent.shotgo.cn.conf`；
- 应用仅监听：`127.0.0.1:3010`。

## 安全顺序

1. 将已评审的 `master` 提交推送到 Fork，确保服务器能够取得不可变 SHA。
2. 安装受支持的 Node 运行时（`^22.19.0` 或 `>=24`），不得修改 PHP、Redis 或 Supervisor。
3. 创建服务用户、发布目录和配置目录；禁止将密钥写入仓库。
4. 本地构建并测试后部署一个不可变版本，再更新 `current` 软链接。
5. 使用 `SHOTGO_ENABLE_TRAFFIC=false` 安装 systemd 服务；先在回环地址验证 `healthz=200`、`readyz=503`。
6. 安装 `agent.shotgo.cn.bootstrap.conf`，创建 `/var/www/certbot`，验证并重载 Nginx，然后为 `agent.shotgo.cn` 单独申请证书。HTTP-01 要求公网 80 端口可达。
7. 证书文件存在后，才使用 `agent.shotgo.cn.conf` 替换 bootstrap 虚拟主机；验证并重载 Nginx，再检查证书 SAN、HTTP 跳转、安全 Header 和公网健康检查。
8. Laravel v1 Client 和完整端到端验收通过前，保持 readiness 关闭。

修改前始终备份当前 Nginx 配置；重载前运行 `nginx -t`；保留上一个 `current` 软链接目标以便回滚。
